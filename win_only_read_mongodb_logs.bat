@echo off
echo Watching MongoDB log file...
powershell -Command "Get-Content 'C:\Program Files\MongoDB\Server\8.0\log\mongod.log' -Tail 20 -Wait"
pause
