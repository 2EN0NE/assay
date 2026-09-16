#!/usr/bin/env bash
# nano-fatebook-agent 一键起步。
#
# 目标：clone 下来跑这一个脚本，按提示走完，就能①打开本地 Web 页面、②在 pi 里
# 跟 agent 对话记录决策。可以重复执行——每一步都先看状态再决定要不要做。
#
# 相关决策：ADR-0021（身份按凭据）、ADR-0022（不需要邮件即可建身份）、
# ADR-0015（CLI 是 agent 的接口）。上手剧本见 docs/uat-pi-agent.md
set -euo pipefail

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
info() { printf '   %s\n' "$*"; }
warn() { printf '   ⚠️  %s\n' "$*" >&2; }
fail() {
  printf '\n❌ %s\n' "$*" >&2
  exit 1
}

cd "$(dirname "$0")"

# ---------------------------------------------------------------- 1. 依赖
step "检查依赖"
command -v node >/dev/null 2>&1 || fail "缺少 Node.js（>= 18）"
command -v npm >/dev/null 2>&1 || fail "缺少 npm"
# 已经自己在跑 Postgres/Mailpit 的人（或用外部数据库做 UAT）可以跳过容器：
# STARTUP_SKIP_DOCKER=1
if [ "${STARTUP_SKIP_DOCKER:-0}" != "1" ]; then
  command -v docker >/dev/null 2>&1 || fail "缺少 Docker：本地 Postgres 与邮件捕获都靠它（已跑着数据库时可设 STARTUP_SKIP_DOCKER=1）"
  docker info >/dev/null 2>&1 || fail "Docker 守护进程没在运行，先把 Docker 起起来"
fi
info "node $(node -v)，npm $(npm -v)"

# ---------------------------------------------------------------- 2. .env
step "准备 .env"
if [ -f .env ]; then
  info ".env 已存在，保持不动"
else
  [ -f .env.example ] || fail "找不到 .env.example"
  cp .env.example .env
  info "已从 .env.example 生成 .env"
fi

# ------------------------------------------------- 3. 数据库与本地邮件捕获
step "启动 Postgres 与 Mailpit"
if [ "${STARTUP_SKIP_DOCKER:-0}" = "1" ]; then
  info "已按 STARTUP_SKIP_DOCKER=1 跳过（假定数据库已在别处跑着）"
else
  # 注意：这一步在镜像不在本地时会拉取，网络慢时看着像卡死。
  docker compose up -d db mail
  info "Postgres: localhost:5432；Mailpit UI: http://localhost:8025（登录邮件在这里看）"
fi

# ------------------------------------------------- 4. 依赖与数据库迁移
step "安装依赖并应用迁移"
[ -d node_modules ] || npm install
npx prisma generate --no-hints
npx prisma migrate deploy

# ---------------------------------------------------------------- 5. 身份
# 身份是 CLI 与 Web 共用的一把钥匙（ADR-0021）。没有它，agent 无法记录任何东西。
step "准备一个身份"
read_env() { grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }

if [ -n "$(read_env FATEBOOK_AGENT_API_KEY)" ]; then
  info ".env 里已有 FATEBOOK_AGENT_API_KEY"
  info "自检：npm run --silent agent -- whoami"
else
  # 交互性判断：没有 tty 时（CI、管道、被其它程序调用）**绝不能**去 read ——
  # `read < /dev/tty` 在没有控制终端时会挂住，而“脚本挂住”是最糟的失败模式。
  # 这种情形下走默认分支，并允许用 STARTUP_MODE / STARTUP_API_KEY / STARTUP_LABEL 驱动。
  interactive=0
  if [ -t 0 ] && [ -r /dev/tty ]; then interactive=1; fi

  mode="${STARTUP_MODE:-}"
  want_key="${STARTUP_API_KEY:-}"
  label="${STARTUP_LABEL:-}"

  if [ "$interactive" = "1" ] && [ -z "$mode" ]; then
    info "还没有凭据（FATEBOOK_AGENT_API_KEY）。两种来源："
    info "  [1] 现在新建一个身份：不需要邮箱、不需要浏览器（ADR-0022）"
    info "  [2] 我已有钥匙：Web 登录后到 /api-setup 复制那串 API key"
    printf '   选择 [1/2]（默认 1）：'
    read -r choice </dev/tty || choice=""
    case "${choice:-1}" in
    2) mode=existing ;;
    *) mode=new ;;
    esac
  fi
  mode="${mode:-new}"

  if [ "$mode" = "existing" ]; then
    if [ -z "$want_key" ] && [ "$interactive" = "1" ]; then
      printf '   粘贴 API key：'
      read -r want_key </dev/tty || want_key=""
    fi
    [ -n "$want_key" ] || fail "需要一个 API key：设 STARTUP_API_KEY=<key> 后重跑"
  else
    if [ -z "$label" ] && [ "$interactive" = "1" ]; then
      printf '   给这个身份起个名字（默认 owner）：'
      read -r label </dev/tty || label=""
    fi
    label="${label:-owner}"
    out="$(npm run --silent agent -- init --label "$label" --allow-create-user)"
    want_key="$(printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).apiKey))')"
    identity_email="$(printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).email))')"
    info "已创建身份：$identity_email"
  fi

  printf '\n# 由 startup.sh 写入：CLI 与 pi 的身份凭据（ADR-0021）\nFATEBOOK_AGENT_API_KEY=%s\n' "$want_key" >>.env
  info "已写入 .env（该文件被 git 忽略，不会进版本库）"
fi

# ---------------------------------------------------------------- 6. 初始词表
# 领域词表是**用户的决定**（ADR-0030 §七）：服务端不会静默造词，写入路径上的未知领域
# 一律大声失败。这四个是上手用的起点，装好之后 `list-domains` 立刻有东西可选；
# 不想要就直接 rename/delete 它们。`add-domain` 是幂等的，重跑不会重复建。
step "准备初始领域词表"
for domain in 投资/宏观 投资/公司业绩 投资/估值与价格 投资/交易水平; do
  if npm run --silent agent -- add-domain --name "$domain" >/dev/null 2>&1; then
    info "词表就绪：$domain"
  else
    warn "建领域词失败：${domain}（可以稍后手动跑 add-domain --name ${domain}）"
  fi
done

# ---------------------------------------------------------------- 7. 技能
# 技能的**源**放在仓库根的 skills/（可见、与 harness 无关）；
# 这里把它**安装**到 agent 的发现目录。.agents/skills/ 是跨 harness 的约定位置，
# 本地 pi 也读它（见 docs/uat-pi-agent.md 的说明与证据）。
step "安装 Agent Skill"
# 技能分两半：捕获（decision-capture）与跟踪（settlement-tracking）。只装一半等于
# 只有捕获没有结算，队列会一直积（ADR-0034）。这里按目录逐个安装，新增技能不必改脚本。
mkdir -p .agents/skills
found_skill=0
for skill_dir in skills/*/; do
  [ -f "${skill_dir}SKILL.md" ] || continue
  skill_name="$(basename "$skill_dir")"
  rm -rf ".agents/skills/$skill_name"
  cp -R "$skill_dir" ".agents/skills/$skill_name"
  info "已安装 ${skill_name}（源在 skills/${skill_name}）"
  found_skill=1
done
[ "$found_skill" = "1" ] || fail "找不到技能源：skills/<技能名>/SKILL.md"
warn "pi 只在**项目被信任**之后才加载项目级技能。首次启动它会问一次；"
warn "不想信任就用显式路径：pi --skill .agents/skills/<技能名>/SKILL.md"

# ---------------------------------------------------------------- 8. 下一步
step "环境就绪。接下来"
cat <<'EOF'
  ① 打开 Web 看复盘：
       npm run dev:e2e            # 明文 http；npm run dev 需要 localhost.pem（本仓库未提供）
       浏览器打开 http://localhost:3000
       登录：填邮箱 → 去 http://localhost:8025 点邮件里的链接

  ② 在 pi 里与 agent 对话（把本仓库作为工作目录）：
       pi --skill .agents/skills/decision-capture/SKILL.md \
          --skill .agents/skills/settlement-tracking/SKILL.md
       然后说：“我在纠结要不要接这个 offer”（捕获）
       或者：“有什么该结算了”（跟踪）

  ③ 完整的上手与验收剧本（含每个环节该看到什么）：
       docs/uat-pi-agent.md

  常用自检：
       npm run --silent agent -- whoami           # 我是谁、凭据从哪来
       npm run --silent agent -- list-decisions   # 我记录过哪些决策
       npm run --silent agent -- list-due         # 到期待结算 / 悬空未结算 两栏
       npm run --silent agent -- domain-report --prefix 投资/宏观   # 领域读数
       npm test                                   # 单元测试
EOF
