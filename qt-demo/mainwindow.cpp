#include "mainwindow.h"
#include "ui_mainwindow.h"

#include <QtWidgets>

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
    , ui(new Ui::MainWindow)
{
    ui->setupUi(this);

    connect(ui->chooseFile, &QPushButton::clicked, [=]() {
        auto path = QFileDialog::getOpenFileName(this);
        setFile(new QFile(path, this));
    });

    connect(this, &MainWindow::fileChanged, [=]{
        ui->filePath->setText(file()->fileName());
    });
}

MainWindow::~MainWindow()
{
    delete ui;
}
