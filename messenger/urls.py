from django.contrib.auth.decorators import login_required
from django.contrib.auth.views import LoginView, LogoutView
from django.urls import path

from . import api, views
from .throttle import throttle_login

app_name = "messenger"

urlpatterns = [
    path("", views.compose, name="compose"),
    path("translator/", views.translator, name="translator"),
    path("history/", views.history, name="history"),
    path("identity/", views.identity, name="identity"),
    path(
        "login/",
        throttle_login(LoginView.as_view(template_name="messenger/login.html")),
        name="login",
    ),
    path("logout/", login_required(LogoutView.as_view()), name="logout"),
    path("api/public-key/", api.publish_public_key, name="api-publish-public-key"),
    path("api/public-key/<str:username>/", api.fetch_public_key, name="api-public-key"),
    path("api/messages/", api.messages, name="api-messages"),
    path("api/messages/<int:message_id>/blob/", api.message_blob, name="api-message-blob"),
    path("api/key-backup/", api.key_backup, name="api-key-backup"),
    path("api/fingerprint/", api.verify_fingerprint, name="api-fingerprint"),
]
