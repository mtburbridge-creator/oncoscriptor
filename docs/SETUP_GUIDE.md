# OncoGenik setup guide

Six settings turn the deployed site into your private, working OncoGenik at https://markburbridge.com/oncogenik. You set them in Vercel, on the `oncoscriptor` project, in three rounds.

You always open OncoGenik at markburbridge.com. The frontpage project forwards that path to `oncoscriptor.vercel.app/oncogenik`. Sign-in works only at markburbridge.com, because your passkey is bound to that name.

| Round | What you do | Time |
|---|---|---|
| A | Add five settings, redeploy | 15 minutes |
| B | Enroll your passkey, add the sixth setting, remove one, redeploy | 5 minutes |
| C | Later, once the Claude routine exists, add two more | 5 minutes |

## Before you start

**Where settings live.** In Vercel, open the `oncoscriptor` project, then **Settings**, then **Environment Variables**. Each setting has a name, a value, a type, and the environments it applies to.

**Three rules for every setting below.**

1. Tick **Production** only. Preview deployments run at different web addresses, and passkeys only work at one address.
2. Choose **Secret** for anything marked secret. Vercel then hides the value after saving, so copy it somewhere safe first if you will need it again.
3. Settings only reach the site on the next deployment. Each round ends with a redeploy for that reason.

**How to make a random value.** Two settings need long random strings. Make them on your own computer, so the value never passes through email, chat, or a website.

On a Mac, open **Terminal** and run the command shown for each setting.

On Windows, open **PowerShell** and run the Windows command shown instead.

A password manager's generator also works. Ask it for 48 or more characters.

---

## Round A

### 1. SESSION_SECRET

| | |
|---|---|
| Value | A random string, 48 bytes |
| Type | Secret |

**Why.** After you sign in, the site gives your browser a login cookie that lasts 12 hours. It signs that cookie with this secret. Anyone holding the secret could forge a cookie and walk in without your passkey, so it must be long, random, and known only to Vercel. Changing it later signs you out everywhere, which is also how you would revoke a stolen session.

**Steps.**

1. Generate the value.
   - Mac: `openssl rand -base64 48`
   - Windows: `$b = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`
2. In Vercel, add a variable named `SESSION_SECRET`, paste the output as the value, choose Secret, tick Production only, save.

You never need this value again, so there is nothing to keep.

### 2. RP_ID

| | |
|---|---|
| Value | `markburbridge.com` |
| Type | Config |

**Why.** A passkey is locked to one website name, called the relying party ID. Your device refuses to use it anywhere else, which is what makes passkeys immune to look-alike phishing sites. This setting tells the server which name to expect. It must match the address bar exactly, with no `https://` and no trailing slash.

**Steps.**

1. Add a variable named `RP_ID` with the value `markburbridge.com`, choose Config, tick Production only, save.

The passkey binds to the whole site name, not to the `/oncogenik` path. That is how WebAuthn works, and it is fine here because every app on markburbridge.com is yours. Do not use `www.markburbridge.com`, which redirects to `markburbridge.com`.

You do not need a separate `ORIGIN` setting. It defaults to `https://` plus this value, which is exactly `https://markburbridge.com`.

If OncoGenik ever moves to another domain, change this to that domain and enroll a new passkey, because the old one stays bound to the old name.

### 3. SETUP_TOKEN

| | |
|---|---|
| Value | A random string, 24 bytes, in hex |
| Type | Secret, temporary |

**Why.** Enrolling a passkey is the most sensitive moment in the app, because whoever enrolls first owns the site. The enrollment door only exists while this token is set, and it only opens for someone who types the token. You delete it right after enrolling in Round B, and the door disappears.

**Steps.**

1. Generate the value.
   - Mac: `openssl rand -hex 24`
   - Windows: `$b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''`
2. Copy the output into a temporary note. You type it into the site in Round B, and Vercel will hide it once saved.
3. Add a variable named `SETUP_TOKEN`, paste the value, choose Secret, tick Production only, save.

### 4. GITHUB_TOKEN

| | |
|---|---|
| Value | A fine-grained GitHub token, starts with `github_pat_` |
| Type | Secret |

**Why.** Every click in OncoGenik, such as approving a script, becomes a commit in your repository. The site's server needs a key to make those commits. A fine-grained token can be limited to this one repository and to file contents only, so even if it leaked it could not touch your other repositories, your settings, or your account.

**Steps.**

1. On GitHub, click your profile picture, then **Settings**.
2. In the left sidebar, click **Developer settings**, then **Personal access tokens**, then **Fine-grained tokens**.
3. Click **Generate new token**.
4. Fill in the form.
   - **Token name**: `oncogenik-vercel`
   - **Expiration**: 1 year. Put a calendar reminder a week before it expires. When it lapses, saving in the app fails with an error until you replace it.
   - **Resource owner**: `mtburbridge-creator`
   - **Repository access**: **Only select repositories**, then pick `oncoscriptor`
   - **Permissions**: under Repository permissions, set **Contents** to **Read and write**. Leave everything else at No access. GitHub adds Metadata read-only on its own, which is expected.
5. Click **Generate token** and copy it immediately. GitHub shows it once.
6. In Vercel, add a variable named `GITHUB_TOKEN`, paste the token, choose Secret, tick Production only, save.

### 5. GITHUB_REPO

| | |
|---|---|
| Value | `mtburbridge-creator/oncoscriptor` |
| Type | Config |

**Why.** The token says what the app may do. This setting says where. It is the owner and repository name, separated by a slash, exactly as it appears in the repository's GitHub address.

**Steps.**

1. Add a variable named `GITHUB_REPO` with the value `mtburbridge-creator/oncoscriptor`, choose Config, tick Production only, save.

The app writes to the `main` branch by default. A sixth optional setting, `GITHUB_BRANCH`, changes that, and you do not need it.

### Finish Round A

1. In Vercel, open the **Deployments** tab.
2. On the top deployment, the one marked Production, open the **⋯** menu and choose **Redeploy**. Clear **Use existing Build Cache** if it is offered, then confirm.
3. Wait for the status to show Ready, about a minute.
4. Open https://markburbridge.com/oncogenik/login and click **Sign in with passkey**.

**What you should see.** "No passkey is enrolled yet." That message means the secret, the site name, and the server are all working. Any other error means a setting is missing or mistyped, and the message names which one.

---

## Round B

### 6. PASSKEY_CREDENTIAL

| | |
|---|---|
| Value | A short block of text the site generates for you |
| Type | Config |

**Why.** A passkey has two halves. The private half is created inside your device and never leaves it. The public half goes to the server, which uses it to check that a sign-in really came from your device. This setting is that public half. It is not secret, because it can only verify signatures, never make them. Storing it in a setting instead of a database keeps the app free of any database to secure.

**Steps.**

1. On the device you will use most, open https://markburbridge.com/oncogenik/login?setup=1. A phone or a Mac with Touch ID both work, and a synced passkey then appears on your other Apple or Google devices too.
2. Under **Enroll a passkey**, paste your setup token into **Setup token** and click **Create passkey**.
3. Approve the prompt with your face, fingerprint, or device PIN.
4. A box labelled **PASSKEY_CREDENTIAL** appears. Click **Copy**.
5. In Vercel, add a variable named `PASSKEY_CREDENTIAL`, paste the copied text exactly, choose Config, tick Production only, save.

### Close the enrollment door

1. In Vercel, find `SETUP_TOKEN`, open its **⋯** menu, and choose **Delete**.
2. Delete the temporary note that held the token.

**Why.** With the token gone, the enrollment pages return "not found" to everyone, including you. Nobody can add a second passkey or replace yours.

### Finish Round B

1. Redeploy again, the same way as Round A.
2. Open https://markburbridge.com/oncogenik/login and click **Sign in with passkey**.
3. Approve the prompt. You land on the OncoGenik dashboard, with the demo project listed under Done.

---

## Round C, later

These two connect the app to the Claude routine. Add them after you create the routine, following `docs/ROUTINE.md`. Until then the app simply skips the wake-up call.

| Name | Value | Type | Why |
|---|---|---|---|
| `ROUTINE_FIRE_URL` | The routine's fire URL | Config | Where the app sends the "new work is ready" signal |
| `ROUTINE_FIRE_TOKEN` | The routine's token, shown once | Secret | Proves the signal came from your app. It can only start that one routine |

Redeploy once both are saved.

---

## If something goes wrong

| What you see | Cause | Fix |
|---|---|---|
| "RP_ID is not set" | Round A not redeployed, or the setting missing | Check the setting exists for Production, then redeploy |
| "Enrollment is closed or the token is wrong" | Token mistyped, or not yet redeployed after adding it | Re-check the note, redeploy, try again |
| Passkey prompt says no passkey for this site | You opened the vercel.app address, or `RP_ID` is not `markburbridge.com` | Use https://markburbridge.com/oncogenik, or fix the setting, redeploy, and enroll again |
| markburbridge.com/oncogenik shows a 404 | The frontpage rewrite for `/oncogenik` is missing or not yet deployed | Check the frontpage `vercel.json` has both `/oncogenik` rules |
| Signed in, but saving fails | `GITHUB_TOKEN` expired or lacks Contents write | Make a new token per step 4, replace the value, redeploy |
| Lost the device that holds the passkey | Synced passkeys survive on your other devices. If none remain, re-enroll | Set a new `SETUP_TOKEN`, redeploy, and repeat Round B |
