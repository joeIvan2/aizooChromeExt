# Privacy Policy for AI Zoo

**Last Updated: September 3, 2026**

## Overview

AI Zoo is committed to protecting your privacy. This privacy policy explains how our Chrome extension handles user data.

## Data Collection

**AI Zoo does NOT collect, store, or transmit personal information to developer-controlled servers.** Questions and conversations are sent directly by your browser to the AI platforms you choose to use.

## Local Storage
The extension uses the browser's `localStorage` API solely to save:
- The current URL of each AI platform (to maintain your conversation state when you switch between them).
- The position of the input box on the screen.
- Platform enable/disable choices, language, Smart Compare summary instructions, and local conversation groups.

These local settings are not synchronized to an AI Zoo server. The AI platforms themselves process your prompts under their own privacy policies and account settings.

## Permissions

### declarativeNetRequest
Used to modify HTTP headers (like removing Content Security Policy or X-Frame-Options) to allow AI platforms to be displayed in iframes.

### Host Permissions
Used to inject functionality into AI platforms and to apply header modifications.

## Third-Party Services

Your use of AI platforms through AI Zoo is subject to each platform's own privacy policy and terms of service:
- [X.AI Privacy Policy](https://x.ai/legal/privacy-policy/)
- [Google Privacy Policy](https://policies.google.com/privacy)
- [Anthropic Privacy Policy](https://www.anthropic.com/privacy)
- [OpenAI Privacy Policy](https://openai.com/privacy/)
- [Meta Privacy Policy](https://www.facebook.com/privacy/policy/)

## Data Security

Since AI Zoo does not collect or transmit any user data to external servers, your conversations remain between you and the AI platforms you choose to use.

## Children's Privacy

AI Zoo does not knowingly collect any information from children under 13 years of age.

## Changes to This Privacy Policy

We may update this privacy policy from time to time. Any changes will be reflected in the "Last Updated" date at the top of this document.

## Contact

For questions about this privacy policy, please contact us by opening an issue on our GitHub repository:
https://github.com/[your-username]/[your-repo-name]/issues

## Your Consent

By using AI Zoo, you consent to this privacy policy.
