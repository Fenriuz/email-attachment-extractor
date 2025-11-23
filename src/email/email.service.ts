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

// Type for generic JSON object since the structure isn't strictly defined
export type JsonResponse = Record<string, unknown> | Array<unknown>;

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async processEmail(source: string): Promise<JsonResponse> {
    this.logger.log(`Processing email from source: ${source}`);

    const emailBuffer = await this.getEmailContent(source);

    let parsed: ParsedMail;
    try {
      parsed = await simpleParser(emailBuffer);
    } catch (error) {
      throw new BadRequestException(
        `Failed to parse email: ${(error as Error).message}`,
      );
    }

    // Extraction Strategy
    // Strategy 1: Attachments
    this.logger.log('Checking attachments for JSON...');
    const attachmentJson = this.extractJsonFromAttachments(parsed);
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
        return Buffer.from(response.data as ArrayBuffer);
      } catch (error) {
        throw new BadRequestException(
          `Failed to fetch email from URL: ${(error as Error).message}`,
        );
      }
    } else {
      if (!fs.existsSync(source)) {
        throw new NotFoundException(`File not found at path: ${source}`);
      }
      try {
        return fs.readFileSync(source);
      } catch (error) {
        throw new BadRequestException(
          `Failed to read file: ${(error as Error).message}`,
        );
      }
    }
  }

  private extractJsonFromAttachments(parsed: ParsedMail): JsonResponse | null {
    if (!parsed.attachments || parsed.attachments.length === 0) return null;

    for (const attachment of parsed.attachments) {
      if (this.isJsonAttachment(attachment)) {
        try {
          const content = attachment.content.toString('utf-8');
          return JSON.parse(content) as JsonResponse;
        } catch (e) {
          this.logger.warn(
            `Found JSON attachment ${attachment.filename} but failed to parse: ${(e as Error).message}`,
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
  ): Promise<JsonResponse | null> {
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

  private async checkLinkForJson(url: string): Promise<JsonResponse | null> {
    try {
      this.logger.debug(`Checking link: ${url}`);
      const response = await axios.get(url, {
        validateStatus: () => true, // Handle errors manually
        timeout: 5000, // 5s timeout to avoid hanging
      });

      if (response.status !== 200) return null;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const contentType: string = response.headers['content-type'] || '';

      // Case: Direct JSON
      if (
        contentType.includes('application/json') ||
        (typeof response.data === 'object' && response.data !== null)
      ) {
        return response.data as JsonResponse;
      }

      // Case: Indirect Link (HTML page)
      if (
        contentType.includes('text/html') &&
        typeof response.data === 'string'
      ) {
        return this.extractJsonFromHtmlPage(response.data, url);
      }
    } catch (error) {
      this.logger.debug(
        `Failed to check link ${url}: ${(error as Error).message}`,
      );
    }
    return null;
  }

  private async extractJsonFromHtmlPage(
    html: string,
    baseUrl: string,
  ): Promise<JsonResponse | null> {
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
      } catch {
        continue; // Invalid URL
      }

      // Heuristic: check if it looks like a json file
      if (absoluteUrl.toLowerCase().split('?')[0].endsWith('.json')) {
        try {
          this.logger.debug(`Checking indirect link: ${absoluteUrl}`);
          const jsonResponse = await axios.get(absoluteUrl, { timeout: 5000 });

          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const contentType: string =
            jsonResponse.headers['content-type'] || '';

          if (
            jsonResponse.status === 200 &&
            (contentType.includes('application/json') ||
              typeof jsonResponse.data === 'object')
          ) {
            return jsonResponse.data as JsonResponse;
          }
        } catch {
          // ignore
        }
      }
    }
    return null;
  }
}
