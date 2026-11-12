@echo off
setlocal EnableExtensions
set "folder="
set "compare="

:parse
if "%~1"=="" goto resolve
if /i "%~1"=="-h" goto usage
if /i "%~1"=="--help" goto usage
if /i "%~1"=="--compare" (
  if "%~2"=="" goto usage_error
  set "compare=%~2"
  shift
  shift
  goto parse
)
set "arg=%~1"
if /i "%arg:~0,10%"=="--compare=" (
  set "compare=%arg:~10%"
  shift
  goto parse
)
if "%arg:~0,1%"=="-" (
  echo lantern: unknown option: %~1 1>&2
  goto usage_error
)
if defined folder goto usage_error
set "folder=%~1"
shift
goto parse

:resolve
if defined compare (
  set compare | findstr /r /c:"^compare=[A-Za-z0-9._/@-]*$" > nul || (
    echo lantern: not a comparison 1>&2
    exit /b 2
  )
  if not defined folder set "folder=."
)
set "project="
if not defined folder goto launch
if not exist "%folder%\" (
  echo lantern: no such directory: %folder% 1>&2
  exit /b 1
)
for %%I in ("%folder%") do set "project=%%~fI"

:launch

set "exe=%~dp0..\..\Lantern.exe"
if not exist "%exe%" (
  echo lantern: Lantern.exe not found next to resources\cli 1>&2
  exit /b 1
)
if defined compare (
  start "" "%exe%" "--project=%project%" "--compare=%compare%"
) else if defined project (
  start "" "%exe%" "--project=%project%"
) else (
  start "" "%exe%"
)
exit /b 0

:usage_error
call :usage 1>&2
exit /b 2

:usage
echo Usage: lantern [folder] [--compare ^<base^>..^<head^> ^| --compare=^<base^>..^<head^>]
echo.
echo   lantern              open Lantern
echo   lantern .            open the current folder in its own window
echo   lantern C:\code\app  open a folder in its own window
echo.
echo   --compare ^<base^>..^<head^>
echo                        open the folder's Lantern tab on a review of ^<head^> against
echo                        where it left ^<base^>. Leave out ^<head^> (or write @) for the
echo                        uncommitted changes. The folder defaults to the current one.
exit /b 0
