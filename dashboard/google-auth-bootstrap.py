import os, json, urllib.request
from google_auth_oauthlib.flow import InstalledAppFlow

# exakte Scopes des Pakets für die 5 Dienste
try:
    from auth.scopes import get_scopes_for_tools
    scopes = list(get_scopes_for_tools(['gmail', 'calendar', 'drive', 'docs', 'sheets']))
except Exception as e:
    from auth.scopes import SCOPES as scopes
    scopes = list(scopes)
    print("fallback scopes:", e, flush=True)

for s in ["openid",
          "https://www.googleapis.com/auth/userinfo.email",
          "https://www.googleapis.com/auth/userinfo.profile"]:
    if s not in scopes:
        scopes.append(s)

cid = os.environ["GOOGLE_OAUTH_CLIENT_ID"]
csec = os.environ["GOOGLE_OAUTH_CLIENT_SECRET"]
client_config = {"installed": {
    "client_id": cid,
    "client_secret": csec,
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "redirect_uris": ["http://localhost"],
}}

print("Starte OAuth-Flow … Browser öffnet sich.", flush=True)
flow = InstalledAppFlow.from_client_config(client_config, scopes=scopes)
creds = flow.run_local_server(
    port=8765, open_browser=True, access_type='offline', prompt='consent',
    authorization_prompt_message='Bitte mit deinem Google-Konto anmelden und Zugriff erlauben …',
    success_message='Jarvis ist jetzt mit Google verbunden — du kannst diesen Tab schliessen.')

email = None
try:
    req = urllib.request.Request("https://www.googleapis.com/oauth2/v2/userinfo",
                                 headers={"Authorization": "Bearer " + creds.token})
    email = json.load(urllib.request.urlopen(req, timeout=15)).get("email")
except Exception as e:
    print("userinfo err:", e, flush=True)

print("EMAIL:", email, flush=True)
print("HAS_REFRESH:", bool(creds.refresh_token), flush=True)
print("SCOPES_GRANTED:", len(creds.scopes or []), flush=True)

from auth.credential_store import get_credential_store
store = get_credential_store()
ok = store.store_credential(email, creds)
print("STORED:", ok, "DIR:", os.environ.get("WORKSPACE_MCP_CREDENTIALS_DIR"), flush=True)
print("DONE", flush=True)
