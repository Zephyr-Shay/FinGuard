FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json *.mjs ./
COPY --chown=node:node public ./public
COPY --chown=node:node tools ./tools
USER node
ENV NODE_ENV=production FINGUARD_BIND=0.0.0.0 FINGUARD_DATA_DIR=/data PORT=4317
EXPOSE 4317
CMD ["node", "server.mjs"]
