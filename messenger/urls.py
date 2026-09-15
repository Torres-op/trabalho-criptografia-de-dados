from django.urls import path
from django.contrib.auth.views import LoginView, LogoutView

from . import views

app_name = "messenger"

urlpatterns = [
    path("", views.compose, name="compose"),
    path("translator/", views.translator, name="translator"),
    path("api/messages/", views.message_list, name="message-list"),
    path("login/", LoginView.as_view(template_name="messenger/login.html"), name="login"),
    path("logout/", LogoutView.as_view(), name="logout"),
]