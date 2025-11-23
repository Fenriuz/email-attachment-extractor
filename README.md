# Email Attachment Extractor

A NestJS service that extracts JSON data from emails. It intelligently looks for JSON in:
1.  **Attachments**: Direct JSON file attachments.
2.  **Direct Links**: Links in the email body pointing to a JSON file.
3.  **Indirect Links**: Links in the email body pointing to a webpage that contains a link to a JSON file.

## 🚀 Setup & Run

1.  **Install dependencies:**
    ```bash
    npm install
    ```

2.  **Start the server:**
    ```bash
    npm start
    ```
    The server will start on `http://localhost:3000`.

## 🧪 Testing with Postman / cURL

The API exposes a single endpoint to process email files (`.eml`).

**Endpoint:** `GET /email/json`
**Query Parameter:** `path` (Path to the .eml file) or `url` (URL to an .eml file)

### Test Cases

We have provided test fixtures in the `test/fixtures/` directory. You can test these scenarios using the paths below.
*Note: The paths provided are relative to the project root. You can also use absolute paths.*

#### 1. JSON Attachment
Extracts JSON directly attached to the email.
```bash
curl "http://localhost:3000/email/json?path=test/fixtures/attachment.eml"
```

#### 2. Direct Link (External)
Extracts JSON from a link in the email body pointing to an external JSON file.
```bash
curl "http://localhost:3000/email/json?path=test/fixtures/link-direct.eml"
```

#### 3. Indirect Link (Scraping)
Extracts JSON by following a link to a landing page, then finding the JSON link on that page.
```bash
curl "http://localhost:3000/email/json?path=test/fixtures/link-indirect.eml"
```

### Testing with External URLs (e.g., GitHub)

You can also provide a URL to an `.eml` file hosted online. 

**Important:** If using GitHub, ensure you use the **Raw** file URL, not the blob view URL.
1.  Go to the file on GitHub.
2.  Click the "Raw" button.
3.  Use that URL.

**Example:**
```bash
curl "http://localhost:3000/email/json?url=https://raw.githubusercontent.com/Fenriuz/email-attachment-extractor/refs/heads/main/test/fixtures/attachment.eml"
```

## 📂 Project Structure

-   `src/email/`: Core logic (Module, Controller, Service).
-   `test/fixtures/`: Sample `.eml` files for testing.
-   `public/`: Static files served to simulate external websites for link testing.
