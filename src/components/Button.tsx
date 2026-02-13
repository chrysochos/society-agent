import React from "react"

interface ButtonProps {
	label: string
	onClick: () => void
}

export const Button: React.FC<ButtonProps> = ({ label, onClick }) => {
	return (
		<button className="btn btn-primary" onClick={onClick}>
			{label}
		</button>
	)
}
