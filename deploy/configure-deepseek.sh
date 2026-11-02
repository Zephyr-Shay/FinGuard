#!/usr/bin/env bash
set -euo pipefail
umask 077
[ "$(id -u)" -eq 0 ] || { echo 'Run with sudo bash deploy/configure-deepseek.sh'; exit 1; }
compose=/opt/finguard/current/compose.yaml
grep -q '/opt/finguard/model.env' "$compose" || { echo 'Update to V1.5 first.'; exit 1; }
read -r -s -p 'DeepSeek API key (hidden): ' model_key </dev/tty
printf '\n'
[[ "$model_key" =~ ^[A-Za-z0-9_.-]{10,300}$ ]] || { echo 'Invalid key format; no changes made.'; exit 1; }
read -r -p 'Model name [deepseek-flash]: ' model_name </dev/tty
model_name=${model_name:-deepseek-flash}
[[ "$model_name" =~ ^[A-Za-z0-9_.-]{1,100}$ ]] || { echo 'Invalid model name; no changes made.'; exit 1; }
tmp=$(mktemp /opt/finguard/.model.env.XXXXXX)
trap 'rm -f -- "$tmp"' EXIT
printf 'FINGUARD_MODEL_URL=https://api.deepseek.com/chat/completions\nFINGUARD_MODEL_KEY=%s\nFINGUARD_MODEL=%s\n' "$model_key" "$model_name" > "$tmp"
unset model_key
chmod 600 "$tmp"
mv -f -- "$tmp" /opt/finguard/model.env
docker compose -f "$compose" up -d --force-recreate --wait --wait-timeout 90
echo 'Configuration saved. Testing one small API request (uses API quota)...'
docker compose -f "$compose" exec -T app node --input-type=module - <<'JS'
import {explainMessage} from './planner.mjs';
try{const text=await explainMessage('只回复：连接成功',[{role:'user',content:'测试连接'}]);if(!text?.trim())throw new Error('empty');console.log('DeepSeek API connection verified.');}catch{console.error('API test failed. Check key, balance, model access or network; do not send your key in screenshots.');process.exitCode=1;}
JS
