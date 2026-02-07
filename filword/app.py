from flask import Flask, render_template

app = Flask(__name__)

@app.route('/')
def root():
    return render_template('python_filword.html')

app.run(port='80', host='0.0.0.0')