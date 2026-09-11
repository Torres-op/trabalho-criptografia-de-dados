from django.contrib.auth.decorators import login_required
from django.shortcuts import render


@login_required
def compose(request):
    return render(request, "messenger/compose.html")


@login_required
def translator(request):
    return render(request, "messenger/translator.html")