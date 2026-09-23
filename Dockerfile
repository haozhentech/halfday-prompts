FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /data && chown node:node /data
USER node
ENV PORT=4190 DATA_DIR=/data
EXPOSE 4190
CMD ["node","server.mjs"]
