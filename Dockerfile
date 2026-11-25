FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server.mjs mcp-espaco.mjs validacao.mjs push.mjs ./
COPY --chown=node:node public ./public
ARG APP_REVISION=dev
ENV APP_REVISION=$APP_REVISION
LABEL org.opencontainers.image.source="https://github.com/Sampaio-Vitor/notas"
LABEL org.opencontainers.image.revision=$APP_REVISION
RUN node -e 'const fs=require("node:fs"); const revision=process.env.APP_REVISION; if(!/^(dev|[a-f0-9]{40})$/.test(revision)) throw Error("Invalid APP_REVISION"); const path="public/sw.js"; fs.writeFileSync(path,fs.readFileSync(path,"utf8").replace("__NOTAS_RELEASE__",revision))'
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=4329 NODE_ENV=production TZ=America/Sao_Paulo
EXPOSE 4329
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=6 CMD node -e "fetch('http://127.0.0.1:4329/healthz').then(async r=>{if(!r.ok || !(await r.json()).ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
