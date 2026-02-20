const express = require('express');
const mysql = require('mysql2');
const path = require('path');

const app = express();
app.use(express.json());


// ================= FRONTEND =================
const FRONTEND_PATH = path.resolve(__dirname, '../frontend');
app.use(express.static(FRONTEND_PATH));


// ================= DB =================
const db = mysql.createConnection({
  host: '127.0.0.1',
  user: 'root',
  password: 'root',
  database: 'hr_system_final'
});

db.connect(err => {
  if (err) {
    console.error("DB connection failed:", err);
    process.exit(1);
  }
  console.log("MySQL Connected");
});


// ================= UTIL =================
function minutesBetween(d1, d2){
  return Math.floor((new Date(d2) - new Date(d1)) / 60000);
}


// ================= LOGIN =================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  db.query(
    "SELECT id, role FROM users WHERE username=? AND password=?",
    [username, password],
    (err, row) => {
      if (err) return res.status(500).json(err);
      if (!row.length) return res.status(401).json({ msg: "invalid" });
      res.json({ role: row[0].role });
    }
  );
});


// ================= DASHBOARD =================
app.get('/api/dashboard', async (req, res) => {
  try {
    const [emp] = await db.promise().query(
      "SELECT COUNT(*) total FROM employees WHERE status='active'"
    );

    const [p] = await db.promise().query(
      "SELECT COUNT(DISTINCT employee_id) present FROM attendance WHERE DATE(checkin)=CURDATE()"
    );

    const [l] = await db.promise().query(
      "SELECT COUNT(*) pending FROM leave_requests WHERE status='pending'"
    );

    res.json({
      totalEmployees: emp[0].total,
      presentToday: p[0].present,
      pendingLeave: l[0].pending
    });

  } catch (err) {
    res.status(500).json(err);
  }
});


// ================= EMPLOYEE =================
app.get('/api/employees', (req, res) => {
  db.query("SELECT * FROM employees ORDER BY id DESC", (err, r) => {
    if (err) return res.status(500).json(err);
    res.json(r);
  });
});

app.post('/api/employees', (req, res) => {
  const { first_name, last_name, department, position } = req.body;

  if (!first_name || !last_name)
    return res.status(400).json({ msg: "missing name" });

  db.query(
    "INSERT INTO employees(first_name,last_name,department,position,status) VALUES(?,?,?,?, 'active')",
    [first_name, last_name, department, position],
    err => {
      if (err) return res.status(500).json(err);
      res.json({ msg: "employee added" });
    }
  );
});


// ================= CHECKIN =================
app.post('/api/checkin', (req, res) => {
  const emp = req.body.employee_id;
  if (!emp) return res.status(400).json({ msg: "employee_id required" });

  db.query(
    "INSERT INTO attendance(employee_id,checkin) VALUES(?,NOW())",
    [emp],
    err => {
      if (err) return res.status(500).json(err);
      res.json({ msg: "checkin success" });
    }
  );
});


// ================= CHECKOUT =================
app.post('/api/checkout', (req, res) => {
  const emp = req.body.employee_id;

  db.query(
    "SELECT * FROM attendance WHERE employee_id=? AND checkout IS NULL ORDER BY id DESC LIMIT 1",
    [emp],
    (err, row) => {
      if (err) return res.status(500).json(err);
      if (!row.length) return res.json({ msg: "no checkin" });

      const record = row[0];

      db.query("UPDATE attendance SET checkout=NOW() WHERE id=?", [record.id]);

      const checkin = new Date(record.checkin);
      const checkout = new Date();

      const start = new Date(); start.setHours(8,30,0,0);
      const end = new Date(); end.setHours(17,30,0,0);

      const late = checkin > start ? minutesBetween(start, checkin) : 0;
      const work = minutesBetween(checkin, checkout);
      const ot = checkout > end ? minutesBetween(end, checkout) : 0;

      db.query(
        `INSERT INTO attendance_summary(employee_id,work_date,late_minutes,work_minutes,ot_minutes)
         VALUES(?,CURDATE(),?,?,?)
         ON DUPLICATE KEY UPDATE
         late_minutes=?, work_minutes=?, ot_minutes=?`,
        [emp, late, work, ot, late, work, ot]
      );

      res.json({ late, work, ot });
    }
  );
});


// ================= LEAVE =================
app.get('/api/leave', (req, res) => {
  db.query(`
    SELECT l.*, CONCAT(e.first_name,' ',e.last_name) employee_name
    FROM leave_requests l
    JOIN employees e ON l.employee_id=e.id
    ORDER BY l.id DESC
  `, (err, r) => {
    if (err) return res.status(500).json(err);
    res.json(r);
  });
});

app.post('/api/leave', (req, res) => {
  const { employee_id, leave_type, leave_date, reason } = req.body;

  db.query(
    "INSERT INTO leave_requests(employee_id,leave_type,leave_date,reason,status) VALUES(?,?,?,?, 'pending')",
    [employee_id, leave_type, leave_date, reason],
    err => {
      if (err) return res.status(500).json(err);
      res.json({ msg: "leave requested" });
    }
  );
});

app.put('/api/leave/:id', (req, res) => {
  db.query(
    "UPDATE leave_requests SET status=? WHERE id=?",
    [req.body.status, req.params.id],
    err => {
      if (err) return res.status(500).json(err);
      res.json({ msg: "leave updated" });
    }
  );
});


// ================= REPORT =================
app.get('/api/report/monthly', (req, res) => {
  db.query(`
    SELECT work_date,
    SUM(work_minutes) total_work,
    SUM(ot_minutes) total_ot,
    SUM(late_minutes) total_late
    FROM attendance_summary
    GROUP BY work_date
    ORDER BY work_date DESC
  `, (err, r) => {
    if (err) return res.status(500).json(err);
    res.json(r);
  });
});

app.get('/api/report/yearly', (req, res) => {
  db.query(`
    SELECT YEAR(work_date) year,
    SUM(work_minutes) total_work,
    SUM(ot_minutes) total_ot,
    SUM(late_minutes) total_late
    FROM attendance_summary
    GROUP BY YEAR(work_date)
    ORDER BY year DESC
  `, (err, r) => {
    if (err) return res.status(500).json(err);
    res.json(r);
  });
});


// ================= DEFAULT PAGE =================
app.get('/', (req, res) => {
  res.sendFile(path.join(FRONTEND_PATH, 'login.html'));
});


app.listen(3000, () => {
  console.log("Server running http://localhost:3000");
});