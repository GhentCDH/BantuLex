FROM caddy:2-alpine

RUN ARCH=$(uname -m | sed 's/aarch64/arm64/;s/x86_64/x86_64/') && \
    wget -qO /tmp/pmtiles.tar.gz \
      "https://github.com/protomaps/go-pmtiles/releases/download/v1.30.0/go-pmtiles_1.30.0_Linux_${ARCH}.tar.gz" && \
    tar xz -C /usr/local/bin pmtiles -f /tmp/pmtiles.tar.gz && \
    rm /tmp/pmtiles.tar.gz

WORKDIR /usr/share/caddy
COPY . .
EXPOSE 80
CMD ["caddy", "file-server", "--root", "/usr/share/caddy", "--listen", ":80"]