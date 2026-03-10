FROM caddy:2-alpine

WORKDIR /usr/share/caddy

COPY . .

EXPOSE 80

CMD ["caddy", "file-server", "--root", "/usr/share/caddy", "--listen", ":80"]
