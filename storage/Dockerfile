FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=dxflrs/garage:v2.3.0 /garage /usr/local/bin/garage

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3900 3901 3902 3903

ENTRYPOINT ["/entrypoint.sh"]
