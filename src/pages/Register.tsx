import { useState } from "react";
import {Link, useNavigate} from "react-router-dom";
import { api, setAuth } from '../../api';
import Logo from "../assets/react.svg";

export default function Register(){
    const nav = useNavigate();
    const [email,setEmail] = useState("");
    const [password,setPassword] = useState("");
    const [name,setName] = useState("");
    const [show,setShow] = useState(false);
    const [loading,setLoading] = useState(false);
    const [error,setError] = useState("");

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            const {data} = await api.post("auth/register",{name,email,password});

            localStorage.setItem("token",data.token);
            setAuth(data.token);
            nav("/dashboard");
        } catch (err) {
            setError((err as any).response?.data.message || "Error al registrar");
        }finally{
            setLoading(false);
        }

    }
    

    return(
        <div className="auth-wrap">
            <div className="card">
                <div className="brand">
                    <img src={Logo} alt="logo-img" />
                    <h2>TO-DO PWA</h2>
                    <p className="muted">
                        Bienvenido, Registrate para continuar
                    </p>
                </div>
                <form onSubmit={onSubmit} className="form">
                    <label htmlFor="">Nombre</label>
                    <input 
                        type="text"
                        placeholder="nombre"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                     />
                    <label htmlFor="">Email</label>
                    <input 
                        type="text"
                        placeholder="tucorreo@dominio.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                     />

                     <label htmlFor="">Contrasena</label>
                     <div className="pass">
                        <input 
                        type={show ? "text" : "password"}
                        placeholder="Ingresa tu contrasena"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        />

                        <button
                            type="button"
                            className="ghost"
                            onClick={() => setShow((s) => !s)}
                            aria-label="Mostrar / ocultar contrasena"
                        />
                     </div>

                     {error && <p className="alert">{error}</p>}
                     <button className="btn primary" disabled={loading}>
                        {loading ? "Cargando..." : "Registrate "}
                     </button>
                     
                </form>

                <div className="footer-links">
                    <span className="muted">Tienes cuenta?</span>
                    <Link to="/">Inicia sesion aqui</Link>
                </div>
            </div>
        </div>
    )
}