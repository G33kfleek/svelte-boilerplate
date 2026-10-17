# Academic Transcripts

Registry-backed transcript verification. Scan a transcript QR code or open its `/verify/<register-number>` link to check a student record and view its profile.

## Verification

QR codes should contain the full public URL, for example:

```text
https://your-domain/verify/TB10/SR/MN/5777/2015
```

Opening the link validates the register number and displays the matching workbook sheet as a read-only table. The page also shows a QR code for sharing that verification route.

## Downloads

PDF and filtered Excel downloads require sign-in. The username is the student's register number. The default password is `password`; set `TRANSCRIPT_PASSWORD` to a private value before deployment. Sessions are limited to the matching register number, and the page provides a sign-out action.

## Run locally

Install dependencies and build the app:

```sh
npm install
NODE_OPTIONS=--openssl-legacy-provider npm run build
```

Start the API and app server:

```sh
TRANSCRIPT_PASSWORD='password' npm start
```

Open `http://localhost:3001/verify/TB10/SR/MN/5777/2015`. The development server can also be run separately on port 3000; it proxies API requests to port 3001:

```sh
NODE_OPTIONS=--openssl-legacy-provider npm run start:dev
```

## Server data

The server reads `src/Assets/documents/TRANSCRIPTS.pdf.xlsx` and `src/Assets/documents/TRANSCRIPTS.pdf`. A register number is accepted only when it matches both a worksheet name and that sheet's register-number field. The complete workbook is not sent to the browser; only the matching profile is returned.

## Privacy and deployment

The profile is visible to anyone who knows a valid register number. Sign-in protects transcript downloads, not profile lookup. Review which student fields are approved for public display, and keep `TRANSCRIPT_PASSWORD` in deployment secrets. Serve the app over HTTPS in production; camera-based QR scanning requires a secure browser context.

## License

Licensed under the MIT License, Copyright © 2019-present Pankod.
