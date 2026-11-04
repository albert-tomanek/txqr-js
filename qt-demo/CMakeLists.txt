cmake_minimum_required(VERSION 3.16)
project(qt_demo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Qt6 REQUIRED COMPONENTS Core Widgets QuickWidgets)
qt_standard_project_setup()

qt_add_executable(qt_demo
    main.cpp
    mainwindow.cpp
    mainwindow.h
    mainwindow.ui
)

# Embed main.qml so the .ui can refer to it as qrc:/main.qml.
qt_add_resources(qt_demo "qml"
    PREFIX "/"
    FILES main.qml
)

target_link_libraries(qt_demo PRIVATE Qt6::Core Qt6::Widgets Qt6::QuickWidgets)
