# Auth and devices screens (card A11)

Covers FR-30, FR-31, NFR-01, AC-11. Sign-in itself happens at Authelia; Mise only shows the screens around it.

## A1. Signed-out landing `/signin`

```
+--------------------------------------+
|                                      |
|                 Mise                 |
|     Recipes and shopping for us      |
|                                      |
|           [ Sign in ]                |  starts the OIDC redirect
|                                      |
+--------------------------------------+
```

Variants (same layout, different message above the button):

| Trigger | Message |
|---|---|
| Session ended or revoked (`401`) | "Your session has ended. Sign in again." |
| Signed out by the user | "You have signed out." |
| Account not provisioned (`?error=not_provisioned`) | "This account isn't set up for Mise. Ask the household administrator." No sign-in retry loop. |
| Fresh authentication failed or timed out | "Sign-in didn't complete. Try again." |
| Unexpected error | Generic message with `correlationId`. |

Behaviour: after successful sign-in, return to the originally requested route (same-origin only), otherwise `/recipes`. A new device session always asks you to authenticate at Authelia again (fresh authentication); do not explain this beyond a short line under the button if the user is confused: "For security, you confirm your identity each time you sign in on a device."

## A2. Settings home `/settings`

```
+--------------------------------------+
| Settings                             |
+--------------------------------------+
| Signed in as Anna                    |
|                                      |
| Devices                            > |
| Sign out of this device              |
+--------------------------------------+
| [Recipes]   [Shopping]   [Settings]  |
+--------------------------------------+
```

"Sign out of this device" ends only this device session, then shows A1 "You have signed out."

## A3. Devices `/settings/devices`

Shows only the signed-in member's own device sessions.

```
+--------------------------------------+
| < Settings        Devices            |
+--------------------------------------+
| Your devices can stay signed in for  |
| a long time. Revoke any you don't    |
| recognise or have lost.              |
+--------------------------------------+
| Pixel 8 - Chrome        THIS DEVICE  |
| Signed in 24 Oct 2026                |
| Last active just now                 |
+--------------------------------------+
| iPhone - Safari                      |
| Signed in 20 Oct 2026                |
| Last active 26 Oct 2026   [ Revoke ] |
+--------------------------------------+
| Laptop - Firefox                     |
| Signed in 2 Oct 2026                 |
| Last active 25 Oct 2026   [ Revoke ] |
+--------------------------------------+
```

Behaviour:
- Device name is derived from the user agent; renaming is not in Milestone A. The current device is marked and has no Revoke button (use "Sign out of this device").
- Order: current device first, then by last active.
- `[ Revoke ]` opens a confirm dialog:

```
+--------------------------------------+
| Revoke "iPhone - Safari"?            |
| It will be signed out immediately    |
| and must sign in again.              |
|                                      |
|        [ Cancel ]  [ Revoke ]        |
+--------------------------------------+
```

- After revoke: the row disappears and a toast confirms. No "revoke all others" in Milestone A.
- States: loading skeleton rows; error with try again; the list always has at least the current device.
- If the current device is revoked from elsewhere, the next request returns `401` and the user sees A1 with the "session has ended" message.
