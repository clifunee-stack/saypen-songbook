@echo off
title Saypen Songbook Git Push
cls
echo ========================================================
echo   Saypen Songbook Auto Git Push
echo ========================================================
echo.

git config user.email "clifunee-stack@users.noreply.github.com"
git config user.name "clifunee-stack"

git remote remove origin 2>nul
git remote add origin https://github.com/clifunee-stack/saypen-songbook.git
git branch -M main

echo [1/3] Adding modified files...
git add .

echo [2/3] Committing changes...
git commit -m "Update saypen songbook app with character search" 2>nul

echo [3/3] Pushing to GitHub (Force Sync)...
git push -u origin main --force

echo.
echo ========================================================
echo   SUCCESS! GitHub Push Completed.
echo   Render will auto-redeploy your site in 1-2 minutes.
echo ========================================================
pause
