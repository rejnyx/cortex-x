# CZ ↔ EN translation pairs — UX microcopy lookup

> Companion to [`../SKILL.md`](../SKILL.md). Loaded on demand when the operator asks for CZ localization, button verbs, error rewrites, or UI string audits. Grounded in Mozilla CZ Localization Style Guide + Microsoft CZ Style Guide + Torrey Podmajersky (Strategic Writing for UX, 2nd ed.) + analysis of Fakturoid / iDoklad / Rohlík / Alza / Apify / Mews production UIs.

## Section 1 — Button verb lookup

Buttons in Czech UI are **infinitives**, not imperatives — eliminates the rod/gender question and works in both vykání and tykání modes.

| Context | EN verb | CZ (infinitive) | Bound constraint |
|---|---|---|---|
| Create a new entity | Create | Vytvořit | Account, project, document |
| Destroy entity | Delete | Smazat | DB-level removal, irreversible |
| Clear field content | Clear | Vymazat | Field/cache stays, content goes |
| Save in context | Save | Uložit | Stay on current screen |
| Submit to backend | Submit | Odeslat | Form posting to server |
| Submit consent | Submit | Potvrdit | Modal agreement, T&C |
| Submit last step | Submit | Dokončit | Wizard completion |
| Submit settings | Submit | Uložit | Configuration change |
| Cancel modal/op | Cancel | Zrušit | Abort an operation |
| Discard unsaved | Discard | Zahodit | Drop draft, no save |
| Edit existing | Edit | Upravit | Never `Editovat` |
| Undo last action | Undo | Zpět / Vrátit zpět | Step back |
| Continue wizard | Continue | Pokračovat | Next step, no commit |
| Go back | Back | Zpět | Navigation, not state revert |
| Confirm | Confirm | Potvrdit | Destructive action prompt |
| Done | Done | Hotovo | Close after success |
| Apply (filters) | Apply | Použít | Local filter apply |
| Sign in | Sign in / Log in | Přihlásit se | Existing account |
| Sign up | Sign up / Register | Registrovat se / Vytvořit účet | New account |
| Sign out | Sign out / Log out | Odhlásit se | End session |
| Get app | Get the app | Stáhnout aplikaci | Never `Získat aplikaci` |
| Learn more | Learn more | Zjistit více / Více informací | Never `Naučit se více` |
| Read more | Read more | Číst dále / Celý článek | Article continuation |
| Search | Search | Hledat | Generic search action |
| Filter | Filter | Filtrovat | Apply filter set |
| Share | Share | Sdílet | Network share |
| Copy | Copy | Kopírovat | Clipboard copy |
| Paste | Paste | Vložit | Clipboard paste |
| Print | Print | Vytisknout | Send to printer |
| Download | Download | Stáhnout | Get file |
| Upload | Upload | Nahrát | Send file |
| Export | Export | Exportovat | Generate downloadable |
| Import | Import | Importovat | Ingest external data |
| Open | Open | Otevřít | Display entity |
| Close | Close | Zavřít | Hide entity/modal |
| Add | Add | Přidat | Insert new item |
| Remove | Remove | Odebrat | Remove from list (not destroy) |
| Move | Move | Přesunout | Change location |
| Rename | Rename | Přejmenovat | Change label |
| Refresh | Refresh | Obnovit | Reload current view |
| Retry | Retry | Zkusit znovu | Re-attempt operation |
| Send | Send | Odeslat / Poslat | Send to recipient |
| Reply | Reply | Odpovědět | Message response |
| Forward | Forward | Přeposlat | Send onward |
| Archive | Archive | Archivovat | Move to archive |
| Restore | Restore | Obnovit | Recover from archive |
| Subscribe | Subscribe | Odebírat | Newsletter, podcast, channel |
| Unsubscribe | Unsubscribe | Odhlásit se z odběru | Stop receiving |
| Follow | Follow | Sledovat | Social-network follow |
| Unfollow | Unfollow | Přestat sledovat | Reverse follow |
| Like | Like | Líbí se mi | Reaction |
| Add to cart | Add to cart | Přidat do košíku | E-commerce |
| Checkout | Checkout | Přejít k pokladně / Dokončit nákup | Begin payment |
| Buy now | Buy now | Koupit | Immediate purchase |
| Continue shopping | Continue shopping | Pokračovat v nákupu | Return to catalog |
| Try free | Try free | Vyzkoušet zdarma | SaaS trial |
| Book demo | Book a demo | Domluvit ukázku | Enterprise sales |
| Get a quote | Get a proposal | Získat cenovou nabídku | Service estimate |
| Contact sales | Contact sales | Kontaktovat obchod | Enterprise lead |
| Book a call | Book a call | Domluvit hovor | Discovery call |
| Schedule | Schedule | Naplánovat | Calendar action |
| Reset password | Reset password | Obnovit heslo | Set new password |
| Change password | Change password | Změnit heslo | Update existing |
| Forgot-password link | Forgot password? | Zapomněli jste heslo? | Question-form CTA link under login form |
| Forgot-password label | Forgot password | Zapomenuté heslo | Static label, not a CTA (e.g., section header on recovery page) |
| Verify email | Verify email | Ověřit e-mail | Confirm address |
| Resend code | Resend code | Odeslat kód znovu | 2FA / OTP |

## Section 2 — Smazat vs Vymazat (the destruction-vs-clearing trap)

EN flexibly uses `Delete` / `Clear` for both senses. CZ is strict:

| Intent | CZ verb | Concrete examples |
|---|---|---|
| Destroy the entity entirely | **Smazat** | Smazat účet, smazat soubor, smazat uživatele, smazat zprávu, smazat příspěvek, smazat projekt |
| Clear the content, keep the container | **Vymazat** | Vymazat textové pole, vymazat filtry, vymazat mezipaměť, vymazat historii, vymazat košík (košík sám stále existuje), vymazat formulář |

Failure mode (real production bug): button labeled `Vymazat účet` is ambiguous — user thinks "just empty the data, keep my login." Always `Smazat účet` for the destruction case.

## Section 3 — Save / Submit / Confirm / Send — the disambiguation table

EN's `Submit` is one verb across 4 distinct meanings. CZ requires picking the right one for each:

| User intent | EN | CZ | Concrete example |
|---|---|---|---|
| Persist data, stay in flow | Save | **Uložit** | Settings change, draft auto-save |
| Send data somewhere for processing | Submit | **Odeslat** | Contact form, application form |
| Agree / authorize | Submit | **Potvrdit** | Terms of service, payment authorization |
| Finalize multi-step flow | Submit / Done | **Dokončit** | Checkout last step, wizard end |
| Send to specific recipient | Send | **Poslat** / **Odeslat** | Message, email, invitation |
| Confirm destructive action | Confirm | **Potvrdit** | "Smazat účet — Potvrdit?" |
| Acknowledge / close | Done | **Hotovo** | Close success modal |

## Section 4 — UI navigation + chrome lookup

| EN | CZ | Note |
|---|---|---|
| Dashboard | Přehled / Nástěnka | `Přehled` for B2B, `Nástěnka` for community/edu products |
| Settings | Nastavení | Neutral standard |
| Preferences | Předvolby | User-specific subset (notifications, etc.) |
| Profile | Profil | User account view |
| Account | Účet | Membership state |
| Billing | Fakturace (B2B) / Vyúčtování (B2C) | Pick by audience |
| Subscription | Předplatné | Recurring plan |
| Plan / Tier | Tarif | Pricing tier |
| Help | Nápověda | In-app docs |
| Support | Podpora | Live assistance |
| Documentation | Dokumentace | Developer docs |
| FAQ | Časté dotazy | Question list |
| Terms of Service | Podmínky služby (general) / Obchodní podmínky (e-comm) | Legal — be precise |
| Privacy Policy | Zásady ochrany osobních údajů | Long form. In footer often shortened to `Ochrana soukromí` |
| Cookies | Cookies | Loanword, ok |
| Notifications | Oznámení | System messages |
| Inbox | Doručená pošta / Schránka | Email-style |
| Drafts | Koncepty | Unsent drafts |
| Trash / Bin | Koš | Recoverable deletion |
| Archive | Archiv | Long-term storage |
| Favorites | Oblíbené | Saved items |
| History | Historie | Action log |
| Activity | Aktivita | Recent actions |

## Section 5 — Form fields + helper text

| EN | CZ | Note |
|---|---|---|
| First name | Jméno | Single field standard |
| Last name | Příjmení | Czech surname convention |
| Email | E-mail | With hyphen. `e-mail` lowercase mid-sentence; `E-mail` capitalized as form-field label or sentence-initial |
| Phone number (optional) | Telefonní číslo (nepovinné) | "Optional" goes in parens |
| Password | Heslo | Standard |
| Confirm password | Potvrzení hesla | Second password field |
| Remember me | Zapamatovat si mě | Login checkbox |
| Forgot password? | Zapomenuté heslo? | Recovery link |
| I agree to the Terms | Souhlasím s podmínkami | Consent checkbox |
| Required field | Povinné pole | Validation marker |
| Optional | Nepovinné | Field marker |
| Min. 8 characters | Min. 8 znaků | Password helper |
| We won't share your number | Vaše číslo s nikým nesdílíme | Privacy reassurance |
| Used for login | Slouží k přihlášení | Email helper |

## Section 6 — Error messages (before / after)

The right shape is **what happened + why + next action**. Never start with `Invalid` / `Failed` / `Chyba` / `Neplatné` / `Zapomněli jste`.

| Wrong (blaming / technical) | Right (helpful + actionable) |
|---|---|
| `Neplatný formát e-mailu.` | `Zadejte e-mail ve formátu jmeno@domena.cz.` |
| `Zapomněli jste přiložit soubor.` | `Před odesláním vyberte soubor jako přílohu.` |
| `Chyba 404. Stránka nenalezena.` | `Tato stránka se ztratila. Odkaz zřejmě nefunguje. Přejít na úvodní stránku.` |
| `Systémová chyba. Přenos selhal.` | `Data se teď nepodařilo načíst. Zkuste stránku obnovit.` |
| `Datum musí být ve formátu DD.MM.RRRR.` | `Zadejte datum v tomto formátu: 25. 5. 2026.` |
| `Špatné heslo.` | `Zadané heslo k tomuto e-mailu nesedí. Zkuste to znovu nebo si heslo obnovte.` |
| `Soubor je příliš velký. Max. 5 MB.` | `Tento soubor je moc velký. Vyberte soubor do 5 MB.` |
| `Uživatelské jméno je obsazeno.` | `Toto jméno už někdo používá. Zkuste k němu přidat čísla.` |
| `Selhání sítě.` | `Jste offline. Připojte se k internetu, ať můžeme změny uložit.` |
| `Zápis odepřen.` | `Pro změnu tohoto nastavení potřebujete administrátorská práva.` |
| `Pole nesmí být prázdné.` | `Toto pole je pro pokračování povinné.` |
| `Hesla se neshodují.` | `Zadaná hesla se neshodují. Zkontrolujte překlepy.` |

## Section 7 — Empty states

Pattern: **identify the state (1 line) + guide what to do (1 line) + primary CTA**.

| Context | EN pattern | CZ pattern |
|---|---|---|
| Inbox / messages | You have no messages yet. When someone writes to you, it will show up here. → [Start a conversation] | Zatím nemáte žádné zprávy. Jakmile vám někdo napíše, objeví se tady. → [Začít konverzaci] |
| Favorites | No favorites saved. Tap the heart icon to save items. → [Browse products] | Nemáte žádné uložené položky. Klikněte na srdíčko u produktu a uložte si ho. → [Prohlížet produkty] |
| Search no results | No results for "X". Try different spelling or broader terms. → [Clear search] | Pro výraz "X" jsme nic nenašli. Zkuste jiné slovo nebo zkontrolujte překlepy. → [Vymazat hledání] |
| Cart | Your cart is empty. Looks like you haven't added anything yet. → [Continue shopping] | Váš košík je prázdný. Vypadá to, že jste si ještě nic nevybrali. → [Pokračovat v nákupu] |
| Invoices | No invoices to display. Generate your first invoice to track income. → [Create invoice] | Nemáte žádné faktury. Vytvořte první fakturu a začněte sledovat příjmy. → [Vytvořit fakturu] |
| Activity log | No recent activity. Your actions will be recorded here automatically. → [Go to dashboard] | Žádná nedávná aktivita. Vaše úkony se zde budou automaticky zaznamenávat. → [Přejít na přehled] |
| Tasks done | All caught up! Enjoy your free time or add a new task. → [Add task] | Vše je hotovo! Užijte si volno, nebo přidejte další úkol. → [Přidat úkol] |
| Offline | No internet connection. We'll refresh this page automatically when you're back online. → [Try again] | Nejste připojeni k internetu. Až budete zpět online, stránku automaticky obnovíme. → [Zkusit znovu] |

## Section 8 — Onboarding + progress + skip

| Element | EN | CZ |
|---|---|---|
| Welcome screen H1 | Let's set up your account | Pojďme nastavit váš účet |
| Progress indicator | Step 2 of 4 | Krok 2 ze 4 |
| Skip link | Skip for now | Prozatím přeskočit |
| Do this later | Do this later | Nastavit později |
| Completion | You're all set | Vše je hotovo |
| First-run prompt | Tap to get started | Klepněte a začněte |

## Section 9 — AI chat-interface microcopy (2024–2026 surface)

This is the newest UI pattern; pulled from current Claude / ChatGPT / Gemini / Perplexity production strings.

| Context | EN | CZ |
|---|---|---|
| Empty composer placeholder | Ask anything, e.g., 'Summarize this PDF' or 'Draft an email'... | Zeptejte se na cokoli, např. 'Shrň tento dokument' nebo 'Napiš e-mail'... |
| Thinking state | Analyzing your document... | Analyzujeme dokument... |
| Thinking state — coding | Generating code... | Generujeme kód... |
| Thinking state — search | Searching the web... | Prohledáváme web... |
| Refusal (neutral) | I cannot help with that, but I can explain the underlying concepts. | S tímto nemohu pomoci, ale můžu vysvětlit související koncepty. |
| Citation surfacing | Based on the provided document: ... | Na základě poskytnutého dokumentu: ... |
| Generation failed | I couldn't generate a response. Try rewording your prompt. | Odpověď se nepodařilo vygenerovat. Zkuste dotaz přeformulovat. |
| Suggestion chip (first-person from user) | "Explain this more simply" | „Vysvětli to jednodušeji“ |
| Stop generation | Stop | Zastavit |
| Regenerate | Regenerate | Vygenerovat znovu |

## Section 10 — Notifications + toasts + system messages

| Context | EN | CZ |
|---|---|---|
| Generic success | Saved. | Uloženo. |
| Generic success (action-named) | Settings saved. | Nastavení bylo uloženo. |
| Snackbar with undo | Message archived. [Undo] | Zpráva byla archivována. [Vzít zpět] |
| Copied to clipboard | Link copied to clipboard. | Odkaz byl zkopírován do schránky. |
| Sent | Message sent. | Zpráva byla odeslána. |
| Connection restored | You're back online. | Jste zpět online. |
| Update available | A new version is available. | K dispozici je nová verze. |
| Session timeout | Your session expired. Sign in again to continue. | Vaše přihlášení vypršelo. Pokračujte přihlášením. |

## Section 11 — Payments + e-commerce transactions

| Context | EN | CZ |
|---|---|---|
| Payment success | Payment successful. We emailed you the receipt. | Platba proběhla úspěšně. Účtenku jsme poslali na e-mail. |
| Payment declined | Your bank declined this payment. Try a different card. | Vaše banka platbu zamítla. Zkuste použít jinou kartu. |
| Card expired | Your card ending in 1234 has expired. Update it to continue. | Platnost karty končící na 1234 vypršela. Aktualizujte ji. |
| Insufficient funds | Insufficient funds. Add money to complete this transfer. | Nedostatek prostředků. Pro dokončení převodu si dobijte kredit. |
| Promo applied | Promo code applied. You saved 200 Kč. | Slevový kód byl uplatněn. Ušetřili jste 200 Kč. |
| Promo invalid | This promo code isn't valid or has expired. | Tento slevový kód neplatí nebo vypršel. |
| Refund initiated | Refund initiated. It may take 3–5 days. | Vrácení peněz bylo zahájeno. Na účtu se objeví do 3–5 dnů. |
| Expected delivery | Expected delivery on Oct 12. | Očekávané doručení 12. října. |

## Section 12 — Auth flows

| Context | EN | CZ |
|---|---|---|
| Bad credentials | We couldn't sign you in. Check your email and password. | Přihlášení se nezdařilo. Zkontrolujte e-mail a heslo. |
| Successful signup | Welcome to [App]. Your account is ready. | Vítejte v aplikaci [App]. Váš účet je připraven. |
| Reset-link sent | We sent a reset link to your email. | Na e-mail jsme odeslali odkaz pro obnovení hesla. |
| Reset-link expired | This link has expired. Request a new one. | Tento odkaz vypršel. Požádejte o nový. |
| Account locked | Account locked for 30 minutes due to multiple attempts. | Účet je kvůli opakovaným pokusům na 30 minut zablokován. |
| Delete account modal | Delete account permanently? This cannot be undone. | Smazat účet trvale? Tuto akci nelze vzít zpět. |
| 2FA prompt | We sent a 6-digit code to [Number]. Enter it below. | Na číslo [Number] jsme poslali šestimístný kód. Zadejte jej níže. |
| Session expired | Your session expired for security reasons. Sign in again. | Z bezpečnostních důvodů vaše přihlášení vypršelo. Přihlaste se znovu. |

## Cross-reference

- Cultural register + anti-patos catalog → [`cz-cultural-lint.md`](cz-cultural-lint.md)
- Hero formula + landing-page sequence + CTA wordbank → [`copywriting-frameworks.md`](copywriting-frameworks.md)
- Voice chart template + intake questionnaire → [`voice-discovery.md`](voice-discovery.md)
- Runtime gates that consume this lookup → [`../SKILL.md`](../SKILL.md) § Phase 5
