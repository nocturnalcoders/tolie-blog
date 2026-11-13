FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    BLOG_UPLOAD_DIR=/data/uploads

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
# Country lookup for the traffic page. Refreshed whenever the image is rebuilt (each deploy).
RUN python fetch_geoip.py geoip/country.mmdb
RUN useradd --system --uid 10001 --home /app app \
 && mkdir -p /data/uploads \
 && chown -R app:app /data
USER app

EXPOSE 8000
CMD ["gunicorn", "-w", "2", "--threads", "4", "-b", "0.0.0.0:8000", "--access-logfile", "-", "app:app"]
