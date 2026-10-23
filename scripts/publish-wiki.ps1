# Publishes docs/wiki to the GitHub wiki of this repository (Windows PowerShell).
#
# Once: on GitHub, open the repository's Wiki tab and create any first page
# (GitHub only makes the wiki's git repository after that). Then run this
# from the repository root:  powershell -File scripts/publish-wiki.ps1
$ErrorActionPreference = "Stop"
$origin = git remote get-url origin
$wiki = ($origin -replace '\.git$', '') + '.wiki.git'
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("cfs-wiki-" + [guid]::NewGuid())
git clone --quiet $wiki $tmp
# The wiki is a copy of docs/wiki: pages removed there are removed here too.
Get-ChildItem $tmp -Filter *.md | Remove-Item
Copy-Item docs/wiki/*.md $tmp
Push-Location $tmp
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host "The wiki is already up to date."
} else {
  git commit --quiet -m "Update the guide from docs/wiki"
  git push --quiet
  Write-Host "Published the guide to $($origin -replace '\.git$', '')/wiki"
}
Pop-Location
Remove-Item -Recurse -Force $tmp
