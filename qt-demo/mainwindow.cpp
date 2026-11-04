#include "mainwindow.h"
#include "ui_mainwindow.h"

#include <QtWidgets>

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
    , ui(new Ui::MainWindow)
{
    ui->setupUi(this);

    m_enc = new TxQR::Encoder(this);

    connect(ui->chooseFile, &QPushButton::clicked, [=]() {
        auto path = QFileDialog::getOpenFileName(this);
        setFile(new QFile(path, this));
    });

    connect(this, &MainWindow::fileChanged, [=]{
        ui->filePath->setText(file()->fileName());

        file()->open(QIODevice::ReadOnly);
        m_enc->setData(file()->readAll());
    });

    auto timer = new QTimer(this);
    bind_prop(ui->period, "value", timer, "interval", &QSpinBox::valueChanged, true);
    timer->start();
    connect(timer, &QTimer::timeout, this, [=]{
        m_currentFrame++;
        if (m_currentFrame >= m_enc->frameCount())
            m_currentFrame = 0;

        showFrame();
    });

    bind_prop(ui->chunkSize, "value", m_enc, "chunkSize", &QSpinBox::valueChanged, true);
    bind_prop(ui->red, "value", m_enc, "redundancy", &QSpinBox::valueChanged, true);
    bind_prop(ui->errorCor, "currentText", m_enc, "ecc", &QComboBox::currentTextChanged, true);
}

MainWindow::~MainWindow()
{
    delete ui;
}

void MainWindow::showFrame()
{
    if (m_enc->data().length()) {
        QImage img(ui->qr->contentsRect().size(), QImage::Format_Grayscale8);
        img.fill(Qt::white);
        QPainter p(&img);

        auto [cells, sideLen] = m_enc->renderMatrix(m_currentFrame);

        QSize squareSize = QSize(1, 1).scaled(img.size(), Qt::KeepAspectRatio);
        QRect squareRect(0, 0, squareSize.width(), squareSize.height());
        squareRect.moveCenter(img.rect().center());

        QRect unit = squareRect;
        unit.setWidth(unit.width() / sideLen);
        unit.setHeight(unit.height() / sideLen);

        int i = 0;
        for (int y = 0; y < sideLen; y++) {
            for (int x = 0; x < sideLen; x++) {
                if (cells[i])
                    p.fillRect(unit, Qt::black);

                unit.translate(unit.width(), 0);
                i++;
            }
            unit.translate(0, unit.height());
            unit.moveLeft(squareRect.left());
        }

        p.end();
        ui->qr->setPixmap(QPixmap::fromImage(img));

        ui->statusBar->showMessage(QString("frame %1/%2").arg(m_currentFrame).arg(m_enc->frameCount()));
    }
    else
        ui->statusBar->clearMessage();
}
