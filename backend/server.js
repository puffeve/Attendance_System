const express = require('express');
const mysql = require('mysql2');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname,'../frontend')));

/* ================= DB ================= */

const db = mysql.createConnection({
  host:'localhost',
  user:'root',
  password:'root',
  database:'hr_system_final'
});

db.connect(err=>{
  if(err){
    console.error("DB connection failed:",err);
    process.exit(1);
  }
  console.log("MySQL Connected");
});

/* ================= UTIL ================= */

function minutesBetween(d1,d2){
  return Math.floor((new Date(d2)-new Date(d1))/60000);
}

/* ================= SIMPLE LOGIN ================= */
/* (ไม่ใช้ JWT ตามที่คุณขอ) */

app.post('/api/login',(req,res)=>{
  const {username,password}=req.body;

  db.query(
    "SELECT id,role FROM users WHERE username=? AND password=?",
    [username,password],
    (err,row)=>{
      if(err) return res.status(500).json(err);
      if(!row.length) return res.status(401).json({msg:"invalid"});
      res.json({role:row[0].role});
    }
  );
});

/* ================= DASHBOARD ================= */

app.get('/api/dashboard',(req,res)=>{

  db.query("SELECT COUNT(*) total FROM employees WHERE status='active'",(err,r1)=>{
    if(err) return res.status(500).json(err);

    db.query("SELECT COUNT(DISTINCT employee_id) present FROM attendance WHERE DATE(checkin)=CURDATE()", (err2,r2)=>{
      if(err2) return res.status(500).json(err2);

      db.query("SELECT COUNT(*) pending FROM leave_requests WHERE status='pending'", (err3,r3)=>{
        if(err3) return res.status(500).json(err3);

        res.json({
          totalEmployees: r1[0].total,
          presentToday: r2[0].present || 0,
          pendingLeave: r3[0].pending || 0
        });

      });
    });
  });
});

/* ================= EMPLOYEE CRUD ================= */

app.get('/api/employees',(req,res)=>{
  db.query("SELECT * FROM employees ORDER BY id DESC",(err,r)=>{
    if(err) return res.status(500).json(err);
    res.json(r);
  });
});

app.post('/api/employees',(req,res)=>{
  const {first_name,last_name,department,position} = req.body;

  if(!first_name || !last_name)
    return res.status(400).json({msg:"missing name"});

  db.query(
    "INSERT INTO employees(first_name,last_name,department,position,status) VALUES(?,?,?,?, 'active')",
    [first_name,last_name,department,position],
    err=>{
      if(err) return res.status(500).json(err);
      res.json({msg:"employee added"});
    }
  );
});

/* ================= CHECKIN ================= */

app.post('/api/checkin',(req,res)=>{
  const emp=req.body.employee_id;
  if(!emp) return res.status(400).json({msg:"employee_id required"});

  db.query(
    "SELECT id FROM attendance WHERE employee_id=? AND DATE(checkin)=CURDATE() AND checkout IS NULL",
    [emp],
    (err,row)=>{
      if(err) return res.status(500).json(err);
      if(row.length) return res.json({msg:"already checked in"});

      db.query(
        "INSERT INTO attendance(employee_id,checkin) VALUES(?,NOW())",
        [emp],
        err2=>{
          if(err2) return res.status(500).json(err2);
          res.json({msg:"checkin success"});
        }
      );
    }
  );
});

/* ================= CHECKOUT (TRANSACTION SAFE) ================= */

app.post('/api/checkout',(req,res)=>{
  const emp=req.body.employee_id;
  if(!emp) return res.status(400).json({msg:"employee_id required"});

  db.beginTransaction(err=>{
    if(err) return res.status(500).json(err);

    db.query(
      "SELECT * FROM attendance WHERE employee_id=? AND DATE(checkin)=CURDATE() AND checkout IS NULL FOR UPDATE",
      [emp],
      (err,row)=>{

        if(err) return db.rollback(()=>res.status(500).json(err));
        if(!row.length) return db.rollback(()=>res.json({msg:"no checkin"}));

        const record=row[0];

        db.query("UPDATE attendance SET checkout=NOW() WHERE id=?",[record.id],err2=>{
          if(err2) return db.rollback(()=>res.status(500).json(err2));

          const checkin=new Date(record.checkin);
          const checkout=new Date();

          const start=new Date(); start.setHours(8,30,0,0);
          const end=new Date(); end.setHours(17,30,0,0);

          const late = checkin>start ? minutesBetween(start,checkin):0;
          const work = minutesBetween(checkin,checkout);
          const ot = checkout>end ? minutesBetween(end,checkout):0;

          db.query(
            `INSERT INTO attendance_summary(employee_id,work_date,late_minutes,work_minutes,ot_minutes)
             VALUES(?,CURDATE(),?,?,?)
             ON DUPLICATE KEY UPDATE
             late_minutes=?,
             work_minutes=?,
             ot_minutes=?`,
            [emp,late,work,ot,late,work,ot],
            err3=>{
              if(err3) return db.rollback(()=>res.status(500).json(err3));

              db.commit(err4=>{
                if(err4) return db.rollback(()=>res.status(500).json(err4));
                res.json({late,work,ot});
              });
            }
          );
        });
      }
    );
  });
});

/* ================= LEAVE ================= */

app.get('/api/leave',(req,res)=>{
  db.query(`
    SELECT l.*, CONCAT(e.first_name,' ',e.last_name) employee_name
    FROM leave_requests l
    JOIN employees e ON l.employee_id=e.id
    ORDER BY l.id DESC
  `,(err,r)=>{
    if(err) return res.status(500).json(err);
    res.json(r);
  });
});

app.post('/api/leave',(req,res)=>{
  const {employee_id,leave_type,leave_date,reason}=req.body;

  db.query(
    "INSERT INTO leave_requests(employee_id,leave_type,leave_date,reason,status) VALUES(?,?,?,?, 'pending')",
    [employee_id,leave_type,leave_date,reason],
    err=>{
      if(err) return res.status(500).json(err);
      res.json({msg:"leave requested"});
    }
  );
});

app.put('/api/leave/:id',(req,res)=>{
  db.query(
    "UPDATE leave_requests SET status=? WHERE id=?",
    [req.body.status,req.params.id],
    err=>{
      if(err) return res.status(500).json(err);
      res.json({msg:"leave updated"});
    }
  );
});

/* ================= REPORT ================= */

app.get('/api/report/monthly',(req,res)=>{
  db.query(`
    SELECT work_date,
    SUM(work_minutes) total_work,
    SUM(ot_minutes) total_ot,
    SUM(late_minutes) total_late
    FROM attendance_summary
    GROUP BY work_date
    ORDER BY work_date
  `,(err,r)=>{
    if(err) return res.status(500).json(err);
    res.json(r);
  });
});

app.get('/api/report/yearly',(req,res)=>{
  db.query(`
    SELECT YEAR(work_date) year,
    SUM(work_minutes) total_work,
    SUM(ot_minutes) total_ot
    FROM attendance_summary
    GROUP BY YEAR(work_date)
  `,(err,r)=>{
    if(err) return res.status(500).json(err);
    res.json(r);
  });
});

/* ================= DEFAULT ================= */

app.get('/',(req,res)=>{
  res.sendFile(path.join(__dirname,'../frontend/login.html'));
});

app.listen(3000,()=>console.log("Server running http://localhost:3000"));
