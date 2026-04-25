FROM dxflrs/garage:v2.3.0

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3900 3901 3902 3903

ENTRYPOINT ["/entrypoint.sh"]
