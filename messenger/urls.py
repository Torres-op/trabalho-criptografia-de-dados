from django.urls import path
from django.contrib.auth.views import LoginView, LogoutView
from . import views
from django.contrib.auth.decorators import login_required


app_name = "messenger"

urlpatterns = [
    path("", views.compose, name="compose"),
    path("translator/", views.translator, name="translator"),
    path("login/", LoginView.as_view(template_name="messenger/login.html"), name="login"),
    path("logout/", login_required(LogoutView.as_view()), name="logout"),
    path("", views.compose, name="compose"),
    path("translator/", views.translator, name="translator"),
]
