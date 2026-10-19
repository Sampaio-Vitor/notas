FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node public ./public
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=4329 NODE_ENV=production TZ=America/Sao_Paulo
EXPOSE 4329
CMD ["node", "server.mjs"]
