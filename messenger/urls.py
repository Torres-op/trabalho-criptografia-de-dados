from django.contrib.auth.decorators import login_required
from django.contrib.auth.views import LoginView, LogoutView
from django.urls import path

from . import api, views

app_name = "messenger"

urlpatterns = [
    path("", views.compose, name="compose"),
    path("translator/", views.translator, name="translator"),
    path("login/", LoginView.as_view(template_name="messenger/login.html"), name="login"),
    path("logout/", login_required(LogoutView.as_view()), name="logout"),
    path("api/public-key/", api.publish_public_key, name="api-publish-public-key"),
    path("api/public-key/<str:username>/", api.fetch_public_key, name="api-public-key"),
    path("api/messages/", api.save_message, name="api-messages"),
]
