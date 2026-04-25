FROM minio/minio:latest

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 9000 9001

ENTRYPOINT ["/entrypoint.sh"]
