# Use a lightweight Python 3.13 image
FROM python:3.13-slim

# Set the working directory inside the container
WORKDIR /app

# Copy the requirements file first to leverage Docker layer caching
COPY requirements.txt .

# Install the Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of your bot's source code into the container
COPY . .

# Expose the API port your bot uses for the frontend
EXPOSE 8080

# Command to run the bot (the -u flag ensures logs print immediately)
CMD ["python", "-u", "main.py"]