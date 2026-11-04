#pragma once

#include <QMainWindow>
#include <QFile>

#include "props.h"
#include "wrapper.h"

QT_BEGIN_NAMESPACE
namespace Ui {
class MainWindow;
}
QT_END_NAMESPACE

class MainWindow : public QMainWindow
{
    Q_OBJECT

    TxQR::Encoder *m_enc;
    int m_currentFrame = 0;

public:
    MAKE_PROPERTY(QFile*, file, File);

    explicit MainWindow(QWidget *parent = nullptr);
    ~MainWindow() override;

private:
    void showFrame();


    Ui::MainWindow *ui;
};
