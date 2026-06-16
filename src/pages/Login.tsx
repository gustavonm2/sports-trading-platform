import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Login.css';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  
  // Extra fields for registration mock
  const [nome, setNome] = useState('');
  const [sobrenome, setSobrenome] = useState('');

  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Temporary MOCK authentication.
    // In the future, here you'd fetch your backend API using the SQL users table.
    localStorage.setItem('auth_token', 'mock_token_123');
    navigate('/dashboard');
  };

  return (
    <div className="login-container">
      <div className="login-background">
        <div className="shape shape-1"></div>
        <div className="shape shape-2"></div>
        <div className="shape shape-3"></div>
      </div>

      <div className="login-box">
        <div className="login-header">
          <h2>{isRegistering ? 'Criar Conta' : 'Bem-vindo de volta'}</h2>
          <p>{isRegistering ? 'Preencha seus dados para começar' : 'Faça login para acessar o sistema'}</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {isRegistering && (
            <div className="input-row">
              <div className="input-group">
                <label>Nome</label>
                <input 
                  type="text" 
                  value={nome} 
                  onChange={(e) => setNome(e.target.value)} 
                  placeholder="Seu nome"
                  required 
                />
              </div>
              <div className="input-group">
                <label>Sobrenome</label>
                <input 
                  type="text" 
                  value={sobrenome} 
                  onChange={(e) => setSobrenome(e.target.value)} 
                  placeholder="Seu sobrenome"
                  required 
                />
              </div>
            </div>
          )}

          <div className="input-group">
            <label>E-mail</label>
            <input 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              placeholder="seu@email.com"
              required 
            />
          </div>

          <div className="input-group">
            <label>Senha</label>
            <input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              placeholder="••••••••"
              required 
            />
          </div>

          {!isRegistering && (
            <div className="forgot-password">
              <a href="#">Esqueceu a senha?</a>
            </div>
          )}

          <button type="submit" className="login-button">
            {isRegistering ? 'Cadastrar' : 'Entrar'}
          </button>
        </form>

        <div className="login-footer">
          <p>
            {isRegistering ? 'Já tem uma conta?' : 'Ainda não tem conta?'}
            <button 
              className="toggle-mode-btn" 
              onClick={() => setIsRegistering(!isRegistering)}
              type="button"
            >
              {isRegistering ? 'Faça login' : 'Criar conta'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
