CREATE DATABASE IF NOT EXISTS hr_system_final;
USE hr_system_final;

CREATE TABLE employees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  department VARCHAR(100),
  position VARCHAR(100),
  status ENUM('active','inactive') DEFAULT 'active'
);

CREATE TABLE attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT,
  checkin DATETIME,
  checkout DATETIME,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE TABLE attendance_summary (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT,
  work_date DATE,
  late_minutes INT,
  work_minutes INT,
  ot_minutes INT,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE TABLE leave_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT,
  leave_type VARCHAR(100),
  leave_date DATE,
  reason TEXT,
  status ENUM('pending','approved','rejected') DEFAULT 'pending',
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);
