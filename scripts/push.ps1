# push.ps1
param (
    [Parameter(Mandatory=$true)]
    [string]$CommitMessage
)

Write-Host "Adding changes..."
git add .

Write-Host "Committing for GitHub (179259864+RathodAkash79@users.noreply.github.com)..."
git -c user.name="Akash Rathod" -c user.email="179259864+RathodAkash79@users.noreply.github.com" commit -m $CommitMessage

Write-Host "Pushing to GitHub (origin)..."
git push origin HEAD:main

# Save the GitHub commit hash so we can revert back to it locally
$githubHash = git rev-parse HEAD

Write-Host "Amending commit for GitLab (akashrathod@arcticnodes.io)..."
git -c user.name="Akash Rathod" -c user.email="akashrathod@arcticnodes.io" commit --amend --no-edit --reset-author

Write-Host "Pushing to GitLab (gitlab) via force push..."
git push gitlab HEAD:main -f

Write-Host "Restoring local branch state to match GitHub..."
git reset --hard $githubHash

Write-Host "Successfully pushed to GitHub and GitLab with their respective author emails!"
