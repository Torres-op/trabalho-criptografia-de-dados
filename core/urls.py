from django.contrib import admin
from django.urls import include, path

admin.site.site_header = "Administração do Treehash"
admin.site.site_title = "Treehash"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", include("messenger.urls")),
]