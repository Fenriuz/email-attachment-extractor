import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { simpleParser, ParsedMail, Attachment } from 'mailparser';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async processEmail(source: string): Promise<any> {
    this.logger.log(`Processing email from source: ${source}`);

    const emailBuffer = await this.getEmailContent(source);

    let parsed: ParsedMail;
    try {
      parsed = await simpleParser(emailBuffer);
    } catch (error) {
      throw new BadRequestException(`Failed to parse email: ${error.message}`);
    }

    // Extraction Strategy
    // Strategy 1: Attachments
    this.logger.log('Checking attachments for JSON...');
    const attachmentJson = await this.extractJsonFromAttachments(parsed);
    if (attachmentJson) {
      this.logger.log('JSON found in attachments.');
      return attachmentJson;
    }

    // Strategy 2 & 3: Links
    this.logger.log('Checking links for JSON...');
    const linkJson = await this.extractJsonFromLinks(parsed.html, parsed.text);
    if (linkJson) {
      this.logger.log('JSON found via links.');
      return linkJson;
    }

    throw new NotFoundException('No JSON found in email attachments or links');
  }

  private async getEmailContent(source: string): Promise<Buffer> {
    if (source.startsWith('http://') || source.startsWith('https://')) {
      try {
        const response = await axios.get(source, {
          responseType: 'arraybuffer',
        });
        return Buffer.from(response.data);
      } catch (error) {
        throw new BadRequestException(
          `Failed to fetch email from URL: ${error.message}`,
        );
      }
    } else {
      if (!fs.existsSync(source)) {
        throw new NotFoundException(`File not found at path: ${source}`);
      }
      try {
        return fs.readFileSync(source);
      } catch (error) {
        throw new BadRequestException(`Failed to read file: ${error.message}`);
      }
    }
  }

  private async extractJsonFromAttachments(
    parsed: ParsedMail,
  ): Promise<any | null> {
    if (!parsed.attachments || parsed.attachments.length === 0) return null;

    for (const attachment of parsed.attachments) {
      if (this.isJsonAttachment(attachment)) {
        try {
          const content = attachment.content.toString('utf-8');
          return JSON.parse(content);
        } catch (e) {
          this.logger.warn(
            `Found JSON attachment ${attachment.filename} but failed to parse: ${e.message}`,
          );
        }
      }
    }
    return null;
  }

  private isJsonAttachment(attachment: Attachment): boolean {
    const contentType = attachment.contentType.toLowerCase();
    const filename = attachment.filename
      ? attachment.filename.toLowerCase()
      : '';
    return (
      contentType.includes('application/json') || filename.endsWith('.json')
    );
  }

  private async extractJsonFromLinks(
    html: string | false,
    text: string | undefined,
  ): Promise<any | null> {
    const links = new Set<string>();

    // Extract from HTML
    if (html) {
      const $ = cheerio.load(html);
      $('a').each((_, element) => {
        const href = $(element).attr('href');
        if (href) links.add(href);
      });
    }

    // Extract from Text (simple regex)
    if (text) {
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const matches = text.match(urlRegex);
      if (matches) {
        matches.forEach((url) => links.add(url));
      }
    }

    for (const link of links) {
      // Skip mailto links or internal anchors
      if (link.startsWith('mailto:') || link.startsWith('#')) continue;

      const result = await this.checkLinkForJson(link);
      if (result) return result;
    }

    return null;
  }

  private async checkLinkForJson(url: string): Promise<any | null> {
    try {
      this.logger.debug(`Checking link: ${url}`);
      const response = await axios.get(url, {
        validateStatus: () => true, // Handle errors manually
        timeout: 5000, // 5s timeout to avoid hanging
      });

      if (response.status !== 200) return null;

      const contentType = response.headers['content-type'] || '';

      // Case: Direct JSON
      if (
        contentType.includes('application/json') ||
        (typeof response.data === 'object' && response.data !== null)
      ) {
        return response.data;
      }

      // Case: Indirect Link (HTML page)
      if (
        contentType.includes('text/html') &&
        typeof response.data === 'string'
      ) {
        return this.extractJsonFromHtmlPage(response.data, url);
      }
    } catch (error) {
      this.logger.debug(`Failed to check link ${url}: ${error.message}`);
    }
    return null;
  }

  private async extractJsonFromHtmlPage(
    html: string,
    baseUrl: string,
  ): Promise<any | null> {
    const $ = cheerio.load(html);
    const links = new Set<string>();
    $('a').each((_, element) => {
      const href = $(element).attr('href');
      if (href) links.add(href);
    });

    for (const link of links) {
      // Resolve relative URLs
      let absoluteUrl = link;
      try {
        absoluteUrl = new URL(link, baseUrl).toString();
      } catch (e) {
        continue; // Invalid URL
      }

      // Heuristic: check if it looks like a json file
      if (absoluteUrl.toLowerCase().split('?')[0].endsWith('.json')) {
        try {
          this.logger.debug(`Checking indirect link: ${absoluteUrl}`);
          const jsonResponse = await axios.get(absoluteUrl, { timeout: 5000 });
          if (
            jsonResponse.status === 200 &&
            (jsonResponse.headers['content-type']?.includes(
              'application/json',
            ) ||
              typeof jsonResponse.data === 'object')
          ) {
            return jsonResponse.data;
          }
        } catch (e) {
          // ignore
        }
      }
    }
    return null;
  }
}
