# AI usage disclosure

## Purpose and scope

This project was implemented with assistance from the OpenAI Codex coding agent in the shared project workspace. The user requested a static Node.js-built RSA signing and verification web application, an understated modern light/dark interface, Vietnamese/English UI, and English `report.pdf` and `AI_USAGE.md` deliverables.

The agent proposed a plan and clarified FIPS expectations, signature formats, key sources, certificate handling, language and private-key export preferences. The user chose a FIPS parameter profile with disclosed limitations, both detached and embedded PDF signatures, generated/imported PEM keys, self-signed/imported PEM certificates, and plaintext/encrypted exports.

## AI-assisted work

- Architecture, React/TypeScript application code, bilingual copy and CSS.
- Web Crypto integration, PEM/PKCS#8 handling through PKI.js/ASN1.js, X.509 certificate creation and CMS signing/verification.
- A bounded PDF structural parser and incremental signature writer. The agent did not implement RSA arithmetic, padding or a random number generator.
- Automated cryptographic, PDF, OpenSSL and UI integration tests, a Playwright browser suite, and build/deployment workflows.
- README, report source, reproducible PDF rendering scripts and this disclosure.
- Diagnosis and correction of issues found during verification, including wrong-password classification, object-reference generation checks, oversized-upload state, and separation of earlier PDF signatures from whole-document integrity.

The frontend-design skill guided a restrained palette, typography hierarchy, responsive workspace and the document/signature/key verification record. System fonts replace the originally proposed packaged Manrope/Noto fonts because font packages were unavailable offline; runtime font/CDN requests are avoided.

## Sources and verification

Primary sources consulted included NIST FIPS 186-5, the W3C Web Crypto specification, RFC 8017, RFC 5652, PKI.js API documentation, Vite deployment documentation and Playwright documentation. NIST's publication page also identifies potential errata; the implementation makes no certification or full-conformance claim. Library source and local type definitions were inspected where needed.

Executed checks include TypeScript checking, static production build, clean `npm ci` from available cache, automated core/PDF tests, independent OpenSSL signature/CMS/key/certificate checks, and React UI tests using jsdom with the actual production crypto worker running through a Node transport. The final test count and limitations are recorded in `report.pdf` / `docs/report.md`.

Real Chromium startup and a localhost listener were attempted and denied by the managed sandbox. The Playwright suite was then attempted and recorded a blocked listener result. No successful real-browser run, screenshot, Adobe Acrobat check, remote deployment, external security audit or FIPS validation is claimed.

## Implementation deviations

The environment could not reach npm registry DNS/network. Cached dependencies were used to install and produce a lockfile; normal installation uses `npm ci`. `@libpdf/core` was unavailable in cache, so a narrower repository-owned PDF adapter was implemented, with explicit unsupported cases and structural tests. This increases PDF parser maintenance responsibilities compared with using a general-purpose PDF library.

Browser permissions also prevented Playwright PDF printing and screenshots. The supplied report was generated with a dependency-free English PDF renderer. A `--browser` report path remains available for Chromium printing and for including future genuine screenshots.

## Responsibility and limitations

Generated code and prose are AI-assisted outputs, not proof of security, legal suitability, independent human review or academic authorship. The tests demonstrate specific behavior in the tested environment; they do not replace a security audit or verification in the intended browser and hosting environment. Human maintainers should review the custom PDF adapter particularly carefully before handling high-assurance documents.

No user document, production private key or password was sent to an external service during implementation. Temporary test keys are generated locally. The application has no document-upload API; that privacy property is supported by code inspection and prepared browser request assertions, with the real-browser check pending because of sandbox restrictions.
