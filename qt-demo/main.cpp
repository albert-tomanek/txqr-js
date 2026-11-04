#include <QApplication>

#include "mainwindow.h"

int main(int argc, char *argv[])
{
    qputenv("QV4_GC_TIMELIMIT", "0");   // Without this the JS lib crashes
    QApplication app(argc, argv);
    MainWindow window;
    window.show();
    return app.exec();
}
