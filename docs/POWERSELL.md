# PowerShell upload guide

Run these commands in Windows PowerShell. They assume Git is installed and the GitHub repository already exists and is empty.

```powershell
cd "$env:USERPROFILE\Downloads"
Expand-Archive -Path ".\Mwakete-POS.zip" -DestinationPath ".\Mwakete-POS" -Force
cd ".\Mwakete-POS"
git init
git branch -M main
git add .
git commit -m "Initial Mwakete POS foundation"
git remote add origin https://github.com/dsc26support-beep/Mwakete-POS.git
git push -u origin main
```

If Git says `remote origin already exists`, run:
```powershell
git remote set-url origin https://github.com/dsc26support-beep/Mwakete-POS.git
git push -u origin main
```

If GitHub asks you to authenticate, complete the browser sign-in. Never paste a password or personal access token into source files.
