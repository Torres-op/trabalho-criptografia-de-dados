from django.urls import path

from . import views

app_name = "messenger"

urlpatterns = [
    path("", views.compose, name="compose"),
    path("translator/", views.translator, name="translator"),
    path("api/messages/", views.message_list, name="message-list"),
]