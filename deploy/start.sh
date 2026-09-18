#!/bin/sh
set -e

python manage.py migrate --noinput
python manage.py seed_users

exec gunicorn core.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-1}" \
  --threads "${WEB_THREADS:-4}" \
  --access-logfile - \
  --error-logfile -
