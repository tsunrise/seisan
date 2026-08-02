# Seisan Privacy Policy

**Effective date:** August 1, 2026

**Last updated:** August 1, 2026

Seisan is a service for managing shared expense projects. The service is operated in the United States by Conghao Shen, operating as tsunrise. This Privacy Policy explains what personal information Seisan processes, why it is processed, who can receive it, how long it may be kept, and how to make a privacy request.

For privacy questions or requests, contact [me@tomshen.io](mailto:me@tomshen.io).

## 1. At a glance

- **The public calculator stays in your browser.** Names, amounts, split settings, and calculated results entered in the calculator are stored in your browser and are not sent to Seisan's servers unless you choose to create a shared project from them. Loading the site still produces ordinary network and security data.
- **Shared projects are stored online.** Project names, members, payment instructions, expense records, balances, and related information are processed on Cloudflare infrastructure so the people with access to a project can collaborate.
- **Public project links are not private.** Logged-out visitors can see substantial project information, including the owner email. A signed-in visitor to a public project can also see linked member emails and member profile information, including payment instructions.
- **Seisan does not sell personal information or run advertising or client-side analytics SDKs.** Cloudflare still processes traffic, security, and service data needed to host and protect Seisan. Expense names are also processed by Cloudflare Workers AI when Seisan suggests an expense category.

## 2. Scope and controller

This policy applies to the Seisan website, application, and API at seisan.waga.me. It does not apply to websites, services, or applications that Seisan does not operate, including services linked from Seisan.

Conghao Shen, operating as tsunrise, is the controller responsible for Seisan's processing of personal information. The controller is established in the United States and can be contacted at [me@tomshen.io](mailto:me@tomshen.io).

## 3. Information we collect and where it comes from

The information Seisan processes depends on the features you use. It may come from you, another person using a shared project, your browser or API client, or Cloudflare services used to deliver and protect Seisan.

### Browser-only calculator information

The public calculator can store member names, payer names, amounts, split selections, ratios, custom shares, and its draft structure in your browser's local storage. Seisan does not receive the calculator draft or result unless you choose to create a project from it. A session check may still be sent to determine whether to offer a signed-in project-creation action.

### Account, authentication, and API-key information

This includes email address, login-attempt identifier, hashed login code, failed-attempt count, attempt timestamps, session-token information, revoked-session token hashes, and authentication status.

If you create API keys, Seisan stores the key ID, label, hashed verifier, account email, creation and expiration times, and any revocation time. Seisan shows the full API-key secret only when the key is created; it stores a cryptographic hash for later verification.

Before sending a login code, Seisan sends the domain portion of the email address to Cloudflare's DNS-over-HTTPS resolver to check whether the domain advertises a possible mail route. This check does not confirm that a specific mailbox exists.

### Project, member, and ledger information

This includes project identifiers and names, owner email, public or restricted access settings, allowed email addresses, member names and linked emails, represented-group size, payment instructions, membership state, balances, and timestamps.

Ledger information includes expenses, expense names, categories, payer and liability splits, transfers, promises to pay, reasons, amounts, record authors and editors, edits, deletion tombstones, settlement plans, and related project activity. Seisan is not intended to collect payment-card numbers, bank-login credentials, government identifiers, health information, biometric identifiers, or precise geolocation.

Payment instructions and free-text fields can contain personal information that you or another project member chooses to enter. Do not enter sensitive information that is not needed to coordinate the shared expense project.

### Category-suggestion information

When a signed-in user types an expense name, Seisan may send that name to its category-classification endpoint. Cloudflare Workers AI converts the name into an embedding and Seisan queries its category index for suggested matches. The suggested category, confidence information, and candidate categories are returned to the browser.

### Technical, security, and operational information

This may include IP address, user-agent and request headers, request URL and time, network and application metadata, errors, service logs, cache entries, rate-limit state, abuse-prevention status, and administrative activity needed to operate and secure Seisan.

Cloudflare Turnstile processes signals such as IP address, TLS fingerprint, user-agent, site key, associated origin, and browser-environment or interaction signals to distinguish people from bots. Cloudflare may also generate short-lived security identifiers or use strictly necessary security storage as described in its notices.

### Support and privacy-request information

If you contact Seisan, we process your contact details, correspondence, verification information, project or account identifiers you provide, and information needed to investigate and respond.

## 4. How we use information and our legal bases

Seisan processes personal information for the following purposes:

- Provide the calculator, authentication, API, shared projects, ledger, balances, and settlement features you request.
- Authenticate users, issue and verify API keys, send login codes, and maintain sessions.
- Display project and member information to people permitted by the project's access settings.
- Suggest expense categories and let users confirm or replace the suggestion.
- Enforce access controls, service limits, and project invariants.
- Detect bots, prevent abuse, investigate errors, maintain reliability, and protect Seisan and its users.
- Respond to privacy, support, security, or legal requests.
- Comply with legal obligations and establish, exercise, or defend legal claims.

Where the EEA or UK data-protection rules apply, Seisan relies on one or more of these legal bases:

- **Contract and requested steps:** processing needed to provide an account, project, API, or other feature you request.
- **Legitimate interests:** operating a reliable shared-ledger service; protecting accounts and projects; preventing abuse; debugging; improving ordinary service functionality; and responding to users. We balance these interests against the effects on individuals.
- **Legal obligation:** processing needed to comply with applicable law or valid legal process.
- **Consent:** processing based on consent if Seisan specifically asks for it for a future optional purpose. Seisan does not currently rely on consent for advertising or analytics.

You are not legally required to provide personal information to Seisan. Email and authentication information are needed to sign in, and project information is needed to use the corresponding shared-project features. Without that information, those features will not work.

## 5. Project visibility and other users

**A public project should be treated as publicly accessible, even when its link is difficult to guess. Do not put information in a public project that you do not want link holders or signed-in visitors to see and copy.**

### Public projects

- A logged-out visitor with the link can see the project name, owner email, member display names, ledger records, expense and promise text, amounts, splits, balances, record authorship, timestamps, and settlement information.
- A signed-in visitor with the link can also see linked member email addresses and member profile information, including represented-group size and payment instructions.
- People who can view a project may copy, export, screenshot, or re-share its information outside Seisan. Seisan cannot control copies made by other users.

### Restricted projects

- Restricted projects are available to the owner, linked members, and authenticated email addresses allowed by the owner.
- Authorized viewers can see the project name, owner email, allowed email list, member names and linked emails, member profile information, ledger records, amounts, balances, timestamps, and settlement information.

### Owners, members, and administrators

- Project owners can manage access settings, allowed emails, member names, linked emails, member profiles, and membership.
- Other active linked members may be able to edit records and certain member information under Seisan's current collaboration rules.
- Seisan administrators may access account, project, limit, and technical information when reasonably needed to operate, secure, debug, or support the service.

## 6. How we disclose information

Seisan may disclose personal information:

- To people who can access the same project, as described in the project-visibility section.
- To Seisan's operator and administrators when needed to operate, secure, debug, or support the service.
- To Cloudflare, which provides network delivery, Workers, Durable Objects, KV, Cache, rate limiting, email sending, Turnstile, Workers AI, and Vectorize services used by Seisan. Cloudflare generally acts as Seisan's processor or service provider for these services. See [Cloudflare's Privacy Policy](https://www.cloudflare.com/privacypolicy/) and [Data Processing Addendum](https://www.cloudflare.com/cloudflare-customer-dpa/).
- To the recipient's email service when Seisan sends a requested login code.
- To comply with applicable law, valid legal process, or government requests.
- To protect the rights, privacy, safety, or security of Seisan, users, or others.
- In connection with a merger, financing, reorganization, transfer of the service, sale of assets, or similar transaction, subject to appropriate protections.
- With your direction or consent.

For Turnstile, Cloudflare acts as Seisan's processor when it uses signals to protect Seisan. Cloudflare also describes itself as an independent controller when it uses those signals to improve Turnstile's bot-detection capabilities. See the [Cloudflare Turnstile Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-policy/).

Seisan does not sell personal information. Seisan does not share personal information for cross-context behavioral advertising and does not use advertising SDKs or client-side analytics SDKs in the application.

## 7. AI-assisted category suggestions

Seisan uses the Cloudflare Workers AI model identified in its current implementation to generate an embedding from an expense name and compare it with category vectors in Cloudflare Vectorize. This produces a suggestion, not a decision about a person. Users can select a different category, and the category does not affect project access, price, eligibility, credit, employment, or another legal or similarly significant outcome.

Seisan does not write the query embedding or candidate list to its category index. If the user posts the expense, the expense name and selected category become part of the project record under the project's access settings.

Cloudflare states that it does not use Workers AI customer content to train AI models or improve Cloudflare or third-party services without explicit consent. See [Cloudflare's Workers AI data-use documentation](https://developers.cloudflare.com/workers-ai/platform/data-usage/). Cloudflare may update its services and terms, so its current documentation also applies to its processing.

## 8. Cookies and browser storage

Seisan uses the following browser storage and access technologies:

- The `__Host-seisan_session` HTTP-only, secure, same-site cookie keeps a browser signed in for up to 30 days unless the user logs out, the session expires, or the token is revoked.
- Cloudflare Turnstile may use strictly necessary security cookies, short-lived identifiers, and browser signals to prevent automated abuse.
- The public calculator stores non-empty drafts in `localStorage`. A draft remains until the user clears it in Seisan, clears site data in the browser, or Seisan removes an incompatible stored format. A blank calculator removes the current draft.
- The project timeline uses `sessionStorage` for a short-lived scroll-restoration hint. Seisan treats the hint as expired after 10 minutes and the browser may also clear it when the browsing session ends.

Seisan does not use third-party advertising cookies or client-side analytics SDKs. Because Seisan does not sell personal information or share it for cross-context behavioral advertising, there is currently no sale or sharing activity for Global Privacy Control to opt out of. Seisan does not respond differently to legacy "Do Not Track" signals, for which there is no uniform response standard.

## 9. Retention

Seisan keeps personal information only for as long as reasonably needed for the purposes described in this policy, subject to the present technical behavior below, service-provider settings, legal obligations, security needs, dispute resolution, and protection of other project members' records.

- Login codes expire after 10 minutes. Related login-attempt records are removed after successful verification, when an expired attempt is verified, or when a later attempt replaces them; an expired row may remain until one of those events or operational cleanup occurs.
- Session cookies last up to 30 days. A revoked-session token hash may remain until the original session would have expired.
- API keys cannot authenticate after expiration or revocation. Verification projections use expiration controls. Expired and revoked source metadata may remain until later API-key maintenance removes it.
- Seisan does not currently apply a fixed automatic expiration to project and ledger data. It may be retained to preserve shared balances, history, edits, deletion tombstones, auditability, and disputes involving other members.
- Deleting a live ledger record removes its balance effect and replaces its stored content with a tombstone rather than erasing the record identifier, author, and audit timing. Deleted members are also retained in a limited form so historical records can still render.
- Project-list cache entries are short-lived. Configuration, rate-limit, security, application, and Cloudflare operational records are retained according to their function and applicable service-provider settings.
- Browser calculator drafts and timeline scroll state follow the browser-storage behavior described above.
- Support and privacy-request correspondence may be retained as needed to respond, keep an appropriate record of the request, comply with law, and resolve disputes.

Deletion requests may be limited where retaining information is necessary to protect another person's rights, preserve a shared ledger, maintain security, comply with law, or exercise another applicable exception. Seisan will assess requests individually rather than treating shared-ledger retention as an automatic exception.

## 10. Security

Seisan uses measures designed to protect personal information, including authenticated access, secure cookies, hashed credentials and codes, access controls, validation at service boundaries, rate limits, anti-bot checks, and Cloudflare security controls. No transmission or storage method is completely secure, so Seisan cannot guarantee absolute security.

If you believe information in Seisan has been accessed or disclosed improperly, contact [me@tomshen.io](mailto:me@tomshen.io).

## 11. International data transfers

Seisan's controller is in the United States. Cloudflare operates a global network, so personal information may be processed in the United States and other countries where Cloudflare and its subprocessors operate. Those countries may have data-protection rules different from the rules where you live.

Where European data-transfer rules apply, Seisan relies on Cloudflare's contractual transfer mechanisms, which may include the EU Standard Contractual Clauses, the UK Addendum, Swiss adaptations, the Data Privacy Framework, and additional safeguards described in Cloudflare's [Data Processing Addendum](https://www.cloudflare.com/cloudflare-customer-dpa/). Contact [me@tomshen.io](mailto:me@tomshen.io) to request more information about applicable safeguards.

## 12. Your privacy rights

Privacy rights depend on where you live and whether a particular law applies to Seisan's processing. You may contact [me@tomshen.io](mailto:me@tomshen.io) to request access, correction, deletion, restriction, objection, or portability, or to ask how Seisan handles your information. Seisan will review the request even when a particular statutory right does not apply.

### Right to object

**Where EEA or UK law applies and Seisan relies on legitimate interests, you may object to that processing based on your particular situation. You may also object at any time to direct marketing; Seisan does not currently use personal information for direct marketing.**

### EEA, UK, and Switzerland

Where applicable, you may have rights to access, correct, erase, restrict, object to processing, or receive a portable copy of personal information. If processing relies on consent, you may withdraw that consent without affecting earlier processing. You may complain to the data-protection authority where you live or work or where you believe a violation occurred.

Seisan does not make decisions based solely on automated processing that produce legal or similarly significant effects. Automated category suggestions, rate limits, security checks, and abuse-prevention systems do not make such decisions.

### California

California privacy law may provide rights to know, access, delete, correct, and receive information about categories, sources, purposes, and recipients; to opt out of sale or sharing; to limit certain uses of sensitive personal information; and not to receive discriminatory treatment for exercising privacy rights. These rights apply to Seisan only to the extent required by applicable law.

In the preceding 12 months, Seisan may have collected these California categories:

- Identifiers, including email addresses, online identifiers, IP addresses, project and member identifiers, session identifiers, and API-key identifiers.
- Internet or electronic network activity, including request metadata, user-agent, security signals, errors, and service interaction data.
- Commercial or transaction-like information, including shared expense records, amounts, balances, project membership, and settlement records.
- User-provided content, including project and member names, payment instructions, allowed emails, expense names, promise reasons, and calculator drafts stored only in the browser.
- Inferences or service-operation summaries, including category suggestions, project summaries, counts, limits, and abuse-prevention status.
- Sensitive personal information to the extent authentication credentials, account access information, or user-entered payment instructions qualify. Seisan uses this information only for service, authentication, security, and user-requested project functions.

In the preceding 12 months, Seisan has not sold personal information and has not shared personal information for cross-context behavioral advertising. Seisan may have disclosed the categories above to project viewers, Cloudflare, email providers, administrators, or legal and security recipients for the purposes described in this policy.

### Other United States privacy rights

Residents of certain U.S. states may have similar rights to access, correct, delete, or obtain a portable copy of personal information, opt out of sale, targeted advertising, or qualifying profiling, and appeal a denied request. Seisan does not sell personal information, use it for targeted advertising, or perform profiling that produces legal or similarly significant effects.

### Making a request

Send requests to [me@tomshen.io](mailto:me@tomshen.io) and describe the account, project, or information involved. Seisan may ask you to sign in, confirm control of an email address, identify relevant project IDs, or provide other information reasonably needed to verify the request. Verification information is used only to verify and respond to the request.

You may use an authorized agent where applicable law allows. Seisan may require proof of the authorization and may ask you to verify your identity directly. Seisan will respond within the time required by applicable law and will explain any denial and available appeal process where required.

## 13. Children

Seisan is intended for people who are at least 13 years old. It is not directed to children under 13, and Seisan does not knowingly collect personal information from children under 13. If you believe a child under 13 provided personal information to Seisan, contact [me@tomshen.io](mailto:me@tomshen.io) so the information can be reviewed and appropriate action taken.

Seisan does not knowingly sell or share personal information of consumers under 16.

## 14. Changes to this policy

Seisan may update this Privacy Policy when the service, providers, or legal requirements change. Material changes will be reflected in the effective or last-updated date and communicated in a manner appropriate to the change.

## 15. Contact

Controller: Conghao Shen, operating as tsunrise

Location: United States

Privacy contact: [me@tomshen.io](mailto:me@tomshen.io)
