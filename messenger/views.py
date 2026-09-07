from django.shortcuts import render


def compose(request):
    return render(request, "messenger/compose.html")


def translator(request):
    return render(request, "messenger/translator.html")
