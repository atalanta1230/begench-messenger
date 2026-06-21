#!/bin/bash
fuser -k 3000/tcp 2>/dev/null
sleep 1
exec node /home/atalanta/begench-messenger/server/index.js
