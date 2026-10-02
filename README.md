# RSA Studio

A static, bilingual document signing workspace built with React, TypeScript and Vite. Documents and cryptographic keys are processed locally using Web Crypto. No backend or upload endpoint is required.

## Run and build

Use Node.js 24 (minimum 22.12) and npm:

```sh
npm ci
npm run dev
```

```sh
npm run build
npm run preview
```

Upload the **contents of `dist/`** to your web server. Production requires HTTPS; `localhost` is suitable for development. Opening `index.html` directly through `file://` is unsupported because module workers and Web Crypto need the correct browser environment. `vite preview` is a local verification server, not a production server.

The default relative asset base supports both root hosting and subdirectories. Keep the trailing slash in the deployed URL, such as `https://example.com/rsa-studio/`. For an explicit path:

```sh
BASE_PATH=/rsa-studio/ npm run build
```

For nginx, adapt `deploy/nginx.conf` inside your HTTPS server block and configure TLS and MIME types normally. Hash navigation (`#keys`, `#sign`, `#verify`) needs no SPA rewrite.

For GitHub Pages, enable **Settings → Pages → Source: GitHub Actions**, push the project, and manually run **Deploy GitHub Pages**. Its workflow builds, tests and uploads `dist/`. The validation workflow also runs browser tests on pull requests and pushes to `main`. This implementation has prepared these workflows; it has not created a remote repository or deployed a live site.

## Use

1. In **Keys**, generate RSA 2048/3072/4096 keys (default 3072) or import a PEM key. Download and securely keep the private key before clearing or reloading the session.
2. In **Sign**, select the original document and choose a detached signature or embedded PDF signature.
3. For detached signatures, share the unchanged original document, `.signature.json`, and public key. In **Verify**, select the original document and signature, then supply the independently obtained public key or certificate.
4. For PDF signing, first create a self-signed certificate or import a matching X.509 PEM certificate. The signed PDF contains the certificate and CMS signature; verification uses the embedded certificate.

Public keys use SPKI PEM (`PUBLIC KEY`). Private keys use PKCS#8 PEM (`PRIVATE KEY` or `ENCRYPTED PRIVATE KEY`). Bare PKCS#1 (`RSA PRIVATE KEY`), RSA-PSS-restricted key containers, P12/PFX and USB tokens are not supported. To convert a conventional PKCS#1 key outside the app:

```sh
openssl pkcs8 -topk8 -nocrypt -in rsa-private.pem -out private-pkcs8.pem
```

Certificate input is a single PEM certificate, not a certificate chain bundle. Exported encrypted keys use standard PBES2/PBKDF2-HMAC-SHA-256 (600,000 iterations) with AES-256-CBC. The export UI requires a matching password of at least 12 characters; plaintext export is available with an explicit warning.

## RSA and FIPS limits

New signatures use RSA-PSS, SHA-256, MGF1-SHA-256 and a 32-byte salt, with exponent 65537 for generated keys. Imported keys must use a supported modulus size and an odd exponent greater than 65536 and less than 2^256. Multiprime private keys are rejected. Exact document bytes are passed to the signature operation; no text conversion or manual prehashing occurs.

The selected parameter profile follows [NIST FIPS 186-5](https://csrc.nist.gov/pubs/fips/186-5/final), particularly sections 5 and A.1.1. **This application is not a FIPS-validated cryptographic module and does not claim full FIPS conformance.** Browser key generation, prime generation and randomness are not attested against all NIST requirements. Signature correctness does not establish certificate trust, signer identity or legal status.

A self-signed certificate is not a trusted identity credential. Confirm the public key fingerprint with the signer through a trusted channel. Certificate expiration is shown separately from signature correctness. No operating-system trust store, chain validation, OCSP/CRL, TSA, trusted signing time, PAdES certification, or long-term validation is provided.

## PDF support

The bounded structural PDF adapter follows cross-reference tables, Flate-compressed cross-reference streams (including 8-bit, single-channel PNG predictors), and compressed object streams. Signing appends a PDF signature dictionary and CMS `adbe.pkcs7.detached` signature without rendering or modifying the original pages. All RSA operations remain in Web Crypto; the adapter does not implement RSA arithmetic.

This version signs **unsigned, unencrypted PDFs only**, one file at a time, up to 50 MiB. Hybrid cross-references, XFA, unsupported compression filters/predictors, malformed references, encrypted PDFs and documents already carrying signatures/certification permissions are rejected. Use a detached signature for unsupported files.

Verification reads supported signature fields, validates ByteRange and the exact excluded Contents span, and checks CMS using PKI.js. It supports SHA-256 RSA-PSS with matching MGF1 and salt lengths 0–32, and SHA-256 RSA PKCS#1 v1.5 signatures for interoperability. ByteRange gaps beyond the signature container are rejected. Additional revisions are reported as changes after signing: a correct earlier signature does not authenticate the whole current PDF. Unsupported structures return errors; verification is not a full PDF shadow-attack, DocMDP or visual-content analysis.

## Privacy

The private CryptoKey lives in a dedicated worker. Clearing the session terminates that worker, drops selected files and inputs, and revokes generated download URLs. Reloading starts a fresh session. Only `rsa-theme` and `rsa-language` preferences are saved in localStorage. Downloads intentionally persist on your disk and must be managed by you. JavaScript cannot guarantee forensic zeroization of process memory.

Fonts are provided by the operating system; no CDN, analytics, runtime third-party script, account or document service is used. As with any browser signing tool, trust the served application code and the device running it.

## Validation and reports

```sh
npm run typecheck
npm test
npx playwright install --with-deps chromium firefox webkit
npm run build
npm run test:e2e
npm run report
```

`npm test` builds the worker first and tests the cryptographic core, PDF parser, independent OpenSSL interoperability, and React UI with that production worker over a Node transport. OpenSSL must be on PATH. UI tests use jsdom, not a real browser engine.

`npm run test:e2e` serves `dist/` temporarily, tests Chromium/Firefox/WebKit, saves screenshots and records results in `test-results/browser-results.json`. It checks root/subpath hosting, imports/exports, signatures, tampering, responsive overflow, themes, session clearing and outgoing requests. Treat `test-results/` as sensitive: browser test downloads include disposable private keys.

The implementation environment permitted clean npm installation from cache, typechecking, builds and tests. It blocked local TCP listeners (`listen EPERM`) and Chromium startup (macOS Mach-port permission denial). Real browser rendering, screenshots, cross-browser results and Adobe Reader interoperability therefore remain unverified here. Prepared automation fails explicitly when blocked and does not label blocked checks as passed.

`report.pdf` and `AI_USAGE.md` are English deliverables at the project root. The PDF source is `docs/report.md`. Default report generation uses a dependency-free, paginated PDF renderer, so it works without browser permissions. To regenerate with Chromium and include actual screenshots when available:

```sh
npm run report -- --browser
```

Screenshots are included only if produced by browser tests; none are fabricated. On macOS, `scripts/check-pdf.swift` provides an optional independent PDFKit parsing check.
