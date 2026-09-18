FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

FROM base AS deps
COPY requirements.txt .
RUN pip install --prefix=/install -r requirements.txt

FROM base AS dev
COPY --from=deps /install /usr/local
ARG UID=1000
ARG GID=1000
RUN groupadd -g ${GID} app && useradd -u ${UID} -g ${GID} -m app
USER app
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

FROM base AS prod
COPY --from=deps /install /usr/local
COPY . .
RUN SECRET_KEY=build-only DJANGO_DEBUG=0 DATABASE_URL=postgres://build:build@build:5432/build python manage.py collectstatic --noinput
RUN useradd -u 1000 -m app && chown -R app:app /app
USER app
EXPOSE 8000
CMD ["sh", "deploy/start.sh"]
